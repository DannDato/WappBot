const db = require('./db')
const OpenAI = require('openai')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const REPORT_TIMEZONE = 'America/Mexico_City'

async function getDailyMessages(referenceDate = new Date()) {
  const [rows] = await db.query(`
    SELECT user_id, role, content, created_at
    FROM messages
    WHERE created_at >= NOW() - INTERVAL 36 HOUR
    ORDER BY user_id, created_at ASC
  `)

  const targetDay = toMexicoDayKey(referenceDate)
  return rows.filter(row => toMexicoDayKey(row.created_at) === targetDay)
}

function toMexicoDayKey(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  return formatter.format(new Date(date))
}

function groupByUser(messages) {
  const grouped = {}

  for (const msg of messages) {
    if (!grouped[msg.user_id]) {
      grouped[msg.user_id] = []
    }

    grouped[msg.user_id].push(msg)
  }

  return grouped
}

function formatConversationBlock(userId, userMessages, contactLabels = {}) {
  const label = contactLabels[userId] || userId
  let text = `\nContacto: ${label}\n`

  userMessages.forEach(msg => {
    text += `${msg.role === 'user' ? 'Usuario' : 'Bot'}: ${msg.content}\n`
  })

  return text
}

async function generateSummary(messages, contactLabels = {}) {
  const grouped = groupByUser(messages)

  let text = ''

  for (const user in grouped) {
    text += formatConversationBlock(user, grouped[user], contactLabels)
  }

  if (!text) return 'Sin actividad relevante hoy.'

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'system',
        content: `
Eres un analista ejecutivo de conversaciones de WhatsApp.

Tu tarea es resumir UNICAMENTE lo importante del dia para que Daniel vea rapido:
- compromisos
- pendientes
- cosas que quedaron para manana
- personas a las que conviene dar seguimiento
- riesgos o respuestas dudosas del bot

Reglas de salida:
- Escribe en espanol.
- Se directo, practico y breve.
- No repitas conversaciones irrelevantes.
- Prioriza hechos accionables.
- Si hay algo comprometido para manana, dilo explicitamente.
- Si una conversacion no dejo pendiente claro, no inventes.

Usa EXACTAMENTE este formato:

📌 Pendientes clave
- ...

👥 Conversaciones importantes
- Nombre/contacto: ...
  Quedo en: ...
  Siguiente paso: ...

⚠️ Ojo
- ...

Si una seccion no tiene contenido, escribe "- Sin novedades".
`
      },
      {
        role: 'user',
        content: text
      }
    ],
    temperature: 0.3,
    max_tokens: 500
  })

  return response.choices[0].message.content
}

module.exports = {
  getDailyMessages,
  generateSummary
}