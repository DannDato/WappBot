const db = require('./db')
const { resolveRecentContactByName } = require('./contactResolver')

const DEFAULT_TTL_DAYS = Number(process.env.OWNER_INSTRUCTION_TTL_DAYS || 2)

function normalizeText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim()
}

function buildExpiryDate(days = DEFAULT_TTL_DAYS) {
  const now = new Date()
  const safeDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS
  now.setDate(now.getDate() + safeDays)
  return now
}

function cleanTopic(text = '') {
  return normalizeText(text)
    .replace(/^sobre\s+/i, '')
    .replace(/^acerca\s+de\s+/i, '')
    .trim()
}

function parseOwnerInstruction(text = '') {
  const value = normalizeText(text)
  if (!value) return null

  const patterns = [
    /^si\s+pregunta\s+(.+?)\s+sobre\s+(.+?)\s+dile\s+que\s+(.+)$/i,
    /^si\s+(.+?)\s+pregunta\s+sobre\s+(.+?)\s+dile\s+que\s+(.+)$/i,
    /^cuando\s+(.+?)\s+pregunte\s+por\s+(.+?)\s+dile\s+que\s+(.+)$/i
  ]

  for (const regex of patterns) {
    const match = value.match(regex)
    if (!match) continue

    const contactHint = normalizeText(match[1])
    const topic = cleanTopic(match[2])
    const response = normalizeText(match[3])

    if (!contactHint || !topic || !response) return null

    return { contactHint, topic, response }
  }

  return null
}

async function saveOwnerInstruction(client, text, options = {}) {
  const parsed = parseOwnerInstruction(text)
  if (!parsed) {
    return {
      ok: false,
      reason: 'parse_failed'
    }
  }

  const resolved = await resolveRecentContactByName(client, parsed.contactHint, 12)
  if (!resolved?.matched) {
    return {
      ok: false,
      reason: resolved?.ambiguous ? 'ambiguous_contact' : 'contact_not_found',
      parsed,
      resolveResult: resolved
    }
  }

  const expiresAt = buildExpiryDate(options.ttlDays)

  await db.query(
    `INSERT INTO owner_instructions (user_id, contact_label, topic, response, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      resolved.userId,
      resolved.label || null,
      parsed.topic,
      parsed.response,
      expiresAt
    ]
  )

  return {
    ok: true,
    instruction: {
      userId: resolved.userId,
      contactLabel: resolved.label,
      topic: parsed.topic,
      response: parsed.response,
      expiresAt
    }
  }
}

async function findInstructionForMessage(userId, messageText = '') {
  const normalizedMessage = normalizeText(messageText).toLowerCase()
  if (!userId || !normalizedMessage) return null

  await db.query(
    `DELETE FROM owner_instructions WHERE expires_at < NOW()`
  )

  const [rows] = await db.query(
    `SELECT id, user_id, contact_label, topic, response, expires_at
     FROM owner_instructions
     WHERE user_id = ?
       AND expires_at >= NOW()
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  )

  if (!rows.length) return null

  const scored = rows
    .map(row => {
      const topic = normalizeText(row.topic).toLowerCase()
      if (!topic) return null

      const topicWords = topic.split(' ').filter(Boolean)
      const hits = topicWords.filter(word => normalizedMessage.includes(word)).length
      const ratio = topicWords.length > 0 ? hits / topicWords.length : 0
      const direct = normalizedMessage.includes(topic) ? 1 : 0
      const score = Math.max(direct, ratio)

      return {
        row,
        score
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best || best.score < 0.6) return null

  return {
    id: best.row.id,
    userId: best.row.user_id,
    contactLabel: best.row.contact_label,
    topic: best.row.topic,
    response: best.row.response,
    expiresAt: best.row.expires_at,
    score: best.score
  }
}

module.exports = {
  parseOwnerInstruction,
  saveOwnerInstruction,
  findInstructionForMessage
}
