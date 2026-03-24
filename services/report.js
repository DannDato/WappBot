const db = require('./db')
const OpenAI = require('openai')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

async function getRecentMessages() {
  const [rows] = await db.query(`
    SELECT user_id, role, content, created_at
    FROM messages
    WHERE created_at >= NOW() - INTERVAL 4 HOUR
    ORDER BY user_id, created_at ASC
  `)

  return rows
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

async function generateSummary(messages) {
  const grouped = groupByUser(messages)

  let text = ''

  for (const user in grouped) {
    text += `\nUsuario: ${user}\n`

    grouped[user].forEach(msg => {
      text += `${msg.role === 'user' ? '👤' : '🤖'}: ${msg.content}\n`
    })
  }

  if (!text) return 'Sin actividad en las últimas 4 horas.'

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'system',
        content: `
Resume conversaciones de WhatsApp.

Hazlo en formato:
- Usuario
- Qué quería
- Cómo respondió el bot
- Si la respuesta fue adecuada o no

Sé breve pero claro.
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
  getRecentMessages,
  generateSummary
}