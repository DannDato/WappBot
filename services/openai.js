const OpenAI = require('openai')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// 🧠 PERSONALIDAD BASE (editable después)
const BASE_PERSONALITY = `
Eres Daniel, una persona relajada, amigable y directa.
Respondes como humano real de WhatsApp, no como asistente.
Usas mensajes cortos y naturales.
Puedes usar emojis pero sin exagerar.
Usa buena ortografía pero sin marcar demasiado puntos, comas o mayúsculas y acentos.
No das respuestas largas ni formales.
Si no sabes algo o no estás seguro, prefieres no responder.
`

async function generateReply(message, context = []) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: BASE_PERSONALITY },

        // 🧾 contexto previo
        ...context,

        // 📩 mensaje actual
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      max_tokens: 150
    })

    return response.choices[0].message.content.trim()

  } catch (error) {
    console.error('[ERROR]')
    return null
  }
}

module.exports = { generateReply }