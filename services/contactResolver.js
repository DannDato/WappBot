const db = require('./db')
const OpenAI = require('openai')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getLikeScore(queryRaw, labelRaw) {
  const query = normalizeText(queryRaw)
  const label = normalizeText(labelRaw)

  if (!query || !label) return 0
  if (label === query) return 1
  if (label.includes(query)) return 0.95
  if (query.includes(label)) return 0.85

  const queryTokens = query.split(' ').filter(Boolean)
  const labelTokens = label.split(' ').filter(Boolean)
  if (queryTokens.length === 0 || labelTokens.length === 0) return 0

  let tokenHits = 0
  for (const token of queryTokens) {
    if (labelTokens.some(labelToken => labelToken.includes(token) || token.includes(labelToken))) {
      tokenHits += 1
    }
  }

  return tokenHits / queryTokens.length
}

function getRankedMatches(inputName, candidates) {
  return candidates
    .map(candidate => ({
      userId: candidate.userId,
      label: candidate.label,
      score: Number(getLikeScore(inputName, candidate.label).toFixed(2))
    }))
    .sort((a, b) => b.score - a.score)
}

async function getRecentConversationCandidates(client, limit = 10) {
  const [activeRows] = await db.query(
    `SELECT user_id, last_human_message AS last_at
     FROM conversations
     WHERE human_active = true
     ORDER BY last_human_message DESC
     LIMIT ?`,
    [limit]
  )

  const [recentRows] = await db.query(
    `SELECT user_id, MAX(created_at) AS last_at
     FROM messages
     GROUP BY user_id
     ORDER BY last_at DESC
     LIMIT ?`,
    [limit]
  )

  const mergedUserIds = []
  for (const row of activeRows) {
    if (!mergedUserIds.includes(row.user_id)) mergedUserIds.push(row.user_id)
  }
  for (const row of recentRows) {
    if (!mergedUserIds.includes(row.user_id)) mergedUserIds.push(row.user_id)
  }

  const selectedUserIds = mergedUserIds.slice(0, limit)

  const candidates = await Promise.all(
    selectedUserIds.map(async (userId) => {
      try {
        const contact = await client.getContactById(userId)
        // Importante: usar primero el nombre con el que TU guardaste el contacto.
        const label = contact.name || contact.pushname || userId.replace('@c.us', '')
        return { userId, label }
      } catch (_) {
        return { userId, label: userId.replace('@c.us', '') }
      }
    })
  )

  return candidates
}

function fallbackMatch(inputName, candidates) {
  const ranked = getRankedMatches(inputName, candidates)
  const best = ranked[0]
  const second = ranked[1]

  if (!best || best.score < 0.45) return null

  // Si hay dos resultados cercanos, pedir confirmacion al usuario.
  if (second && second.score >= 0.45 && Math.abs(best.score - second.score) <= 0.12) {
    return {
      matched: false,
      ambiguous: true,
      reason: 'ambiguous_fallback',
      options: [
        { userId: best.userId, label: best.label, score: best.score },
        { userId: second.userId, label: second.label, score: second.score }
      ],
      candidates
    }
  }

  return {
    matched: true,
    userId: best.userId,
    label: best.label,
    confidence: best.score,
    reason: 'fallback_like'
  }
}

async function resolveRecentContactByName(client, inputName, limit = 10) {
  const candidates = await getRecentConversationCandidates(client, limit)

  if (candidates.length === 0) {
    return {
      matched: false,
      reason: 'no_candidates',
      candidates: []
    }
  }

  const prompt = `
Debes elegir el contacto mas probable para el texto "${inputName}".

Reglas:
- Solo puedes elegir uno de los candidatos listados.
- Si no hay match razonable, responde matched=false.
- Acepta variaciones, apodos o errores menores de escritura.
- Prioriza el campo "label" porque representa el nombre guardado por el dueño en su agenda.
- No inventes usuarios fuera de la lista.

Candidatos:
${JSON.stringify(candidates, null, 2)}

Responde UNICAMENTE JSON valido con este formato:
{
  "matched": true/false,
  "userId": "... o null",
  "label": "... o null",
  "confidence": 0-1,
  "reason": "explicacion corta"
}
`

  try {
    const likeMatch = fallbackMatch(inputName, candidates)
    if (likeMatch && likeMatch.confidence >= 0.75) {
      return likeMatch
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'Eres un resolutor de contactos. Solo devuelves JSON valido.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 180
    })

    const text = response.choices[0].message.content.trim()
    const parsed = JSON.parse(text)

    if (!parsed.matched) {
      const fallback = fallbackMatch(inputName, candidates)
      if (fallback && fallback.ambiguous) return fallback

      return {
        matched: false,
        reason: parsed.reason || 'no_match',
        candidates
      }
    }

    const selected = candidates.find(candidate => candidate.userId === parsed.userId)
    if (!selected) {
      return {
        matched: false,
        reason: 'selected_user_not_in_candidates',
        candidates
      }
    }

    const confidence = Number(parsed.confidence ?? 0)
    if (Number.isFinite(confidence) && confidence < 0.45) {
      return {
        matched: false,
        reason: 'low_confidence',
        candidates
      }
    }

    return {
      matched: true,
      userId: selected.userId,
      label: selected.label,
      confidence: Number.isFinite(confidence) ? confidence : 0.5,
      reason: parsed.reason || 'matched'
    }
  } catch (_) {
    const fallback = fallbackMatch(inputName, candidates)
    if (fallback) return fallback

    return {
      matched: false,
      reason: 'resolver_error',
      candidates
    }
  }
}

module.exports = {
  resolveRecentContactByName
}
