const OpenAI = require('openai')
const logger = require('./logger')
const { recordTokenUsage } = require('./tokenUsage')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// PREFILTRO LOCAL
function localPreFilter(message) {
  const msg = message.toLowerCase()

  const forbidden = [
    'donde estas', 'dónde estás',
    'ya llegaste', 'ya estás',
    'andas en tu casa'
  ]

  if (forbidden.some(f => msg.includes(f))) {
    return { shouldReply: false, askHuman: true, isContinuation: false }
  }

  const ignore = ['ok', 'jaja', 'luego te digo', 'te marco']

  if (ignore.includes(msg.trim())) {
    return { shouldReply: false, askHuman: false, isContinuation: false }
  }

  return null
}

// 🧠 CONTEXTO MINIMO
function getCompactHistory(context = []) {
  if (!context.length) return ''

  return context.slice(-2).map(m =>
    `${m.role === 'user' ? 'U' : 'A'}:${m.content}`
  ).join('|')
}

async function decideReply(message, context = []) {
  try {
    // 🚫 FILTRO LOCAL
    const localDecision = localPreFilter(message)
    if (localDecision) {
      logger.info('[DECISION] Local filter aplicado', localDecision)
      return { ...localDecision, confidence: 0.9 }
    }

    const history = getCompactHistory(context)

    const prompt = `
Hist:${history || 'none'}
Msg:${message}

Reglas:
- Continuacion => responder
- Tiempo real / personal => humano
- Irrelevante => no responder

JSON:
{"r":true/false,"h":true/false,"c":true/false}
`

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'Clasificador. Solo JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
      max_tokens: 40
    })

    await recordTokenUsage({
      source: 'decideReply',
      model: 'gpt-4.1-mini',
      usage: response.usage
    })

    const text = response.choices[0].message.content.trim()

    try {
      const parsed = JSON.parse(text)

      const decision = {
        shouldReply: parsed.r,
        askHuman: parsed.h,
        isContinuation: parsed.c,
        confidence: 0.8
      }

      logger.info('[DECISION] Resultado', decision)

      return decision

    } catch {
      logger.warn('[DECISION] JSON invalido', { raw: text })
      return { shouldReply: false, askHuman: true, confidence: 0 }
    }

  } catch (error) {
    logger.error('[ERROR] decision', error)
    return { shouldReply: false, askHuman: true, confidence: 0 }
  }
}

module.exports = { decideReply }