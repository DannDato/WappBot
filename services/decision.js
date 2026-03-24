const OpenAI = require('openai')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

async function decideReply(message, context = []) {
  try {
    const prompt = `
Eres un sistema que decide si un bot de WhatsApp debe responder o no.

Reglas IMPORTANTES:
- NO responder si el mensaje parece:
  - Muy personal
  - Confidencial
  - Algo que claramente requiere a un humano
  - Mensajes tipo: "luego te digo", "te marco", "oye tú"
- NO responder si no estás seguro
- Responder SOLO si es algo casual, común o seguro

Responde en JSON válido con:
{
  "shouldReply": true/false,
  "confidence": 0-1,
  "reason": "explicación corta"
}

Mensaje:
"${message}"
`

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'Eres un clasificador estricto.' },
        ...context,
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 100
    })

    const text = response.choices[0].message.content.trim()

    try {
      return JSON.parse(text)
    } catch (err) {
      console.log('[DECISION] Respuesta no es JSON válido:', text)
      return { shouldReply: false, confidence: 0, reason: 'parse_error' }
    }

  } catch (error) {
    console.error('[ERROR] Error al decidir respuesta', error)
    return { shouldReply: false, confidence: 0, reason: 'error' }
  }
}

module.exports = { decideReply }