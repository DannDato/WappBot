const OpenAI = require('openai')
const logger = require('./logger')
const { recordTokenUsage } = require('./tokenUsage')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// 🧠 BASE ULTRA COMPACTA
const BASE_PERSONALITY = `
Eres Daniel (Dato). Mexicano, relajado, directo.
Hablas como WhatsApp: corto, natural.

Reglas:
- Usa "tú"
- Sin formalidad
- No sonar robot
- No inventes info
- Sé claro y breve

Contexto:
- Rapero/productor + ingeniero en computación
- Streams: lun/mie/vie 7–10pm CDMX
- Trabajo: 8am–4pm (suele responder ahí)

`

const PERSONAS = {
  profesional: `Profesional, claro, sin slang.`,
  rapper: `Urbano leve, fresco.`,
  Hermana: `Familiar, cálido.`,
  Esposa: `Cariñoso, cercano. Viven juntos.`,
  Bro: `Relajado, bromista.`
}

// 🧠 Detecta si el mensaje NECESITA contexto
function needsContext(message) {
  const triggers = [
    'eso', 'asi', 'tambien', 'igual', 'entonces',
    'lo que', 'ya', 'como te dije', 'te dije',
    'otra vez', 'eso mismo'
  ]

  const msg = message.toLowerCase()
  return triggers.some(t => msg.includes(t))
}

// 🧠 Extrae SOLO lo mínimo útil
function getSmartContext(context = []) {
  if (!context.length) return ''

  const lastTurns = context.slice(-4) // max 2 user + 2 assistant

  const compact = lastTurns.map(m => {
    const role = m.role === 'user' ? 'U' : 'A'
    return `${role}:${m.content}`
  }).join(' | ')

  return `Ctx:${compact}`
}

// 🧠 Modo ultra ligero para mensajes simples
function isSimpleMessage(message) {
  return message.length < 40
}

// 🧠 Limpieza final (reduce tokens de salida)
function cleanResponse(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
}

async function generateReply(message, context = [], persona = null, contactName = '') {
  try {
    const personaTone = persona ? (PERSONAS[persona.toLowerCase()] ?? '') : ''

    const useContext = needsContext(message)
    const simpleMode = isSimpleMessage(message)

    const smartContext = useContext ? getSmartContext(context) : ''

    // 🧠 Prompt dinámico
    let systemContent = BASE_PERSONALITY

    if (personaTone) systemContent += `\n${personaTone}`

    if (contactName) {
      systemContent += `\nNombre: ${contactName}`
    }

    if (useContext && smartContext) {
      systemContent += `\n${smartContext}`
    }

    // 🔥 modo ultra compacto
    if (simpleMode && !useContext) {
      systemContent += `\nResponde en 1 frase.`
    }

    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: message }
    ]

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages,
      temperature: 0.7,
      max_tokens: simpleMode ? 60 : 100
    })

    await recordTokenUsage({
      source: 'generateReply',
      model: 'gpt-4.1-mini',
      usage: response.usage
    })

    logger.info('[OPENAI] Tokens usados', {
      total: Number(response.usage?.total_tokens || 0),
      prompt: Number(response.usage?.prompt_tokens || 0),
      completion: Number(response.usage?.completion_tokens || 0),
      usedContext: useContext,
      simpleMode
    })

    return cleanResponse(response.choices[0].message.content)

  } catch (error) {
    logger.error('[OPENAI] Error', error)
    return null
  }
}

/**
 * RESPUESTA DESDE HINT (optimizada igual)
 */
async function generateReplyFromHint(originalQuestion, ownerHint, context = []) {
  try {
    const normalizedHint = String(ownerHint || '').replace(/\s+/g, ' ').trim()
    const hintWordCount = normalizedHint ? normalizedHint.split(' ').length : 0

    const useContext = needsContext(originalQuestion)
    const smartContext = useContext ? getSmartContext(context) : ''

    let systemContent = `${BASE_PERSONALITY}
Responde directo. Usa la pista.`

    if (smartContext) {
      systemContent += `\n${smartContext}`
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: `Msg: "${originalQuestion}"\nHint: "${ownerHint}"`
        }
      ],
      temperature: 0.4,
      max_tokens: hintWordCount <= 4 ? 40 : 80
    })

    await recordTokenUsage({
      source: 'generateReplyFromHint',
      model: 'gpt-4.1-mini',
      usage: response.usage
    })

    logger.info('[OPENAI] Tokens hint', {
      total: Number(response.usage?.total_tokens || 0)
    })

    return cleanResponse(response.choices[0].message.content)

  } catch (error) {
    logger.error('[OPENAI] Error hint', error)
    return ownerHint.trim()
  }
}

module.exports = { generateReply, generateReplyFromHint }