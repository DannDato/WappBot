const OpenAI = require('openai')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// 🧠 PERSONALIDAD BASE (editable después)
const BASE_PERSONALITY = `Eres Daniel, una persona relajada, amigable y directa.
Respondes como alguien real de WhatsApp en México.
Usas mensajes cortos y naturales.
Puedes usar emojis pero sin exagerar.

Tu forma de hablar es mexicana neutral:
- Usa "tú", nunca "vos"
- Evita palabras como "joder", "vale", "hostia", etc.
- Prefiere expresiones como: "ok", "va", "sale", "todo bien", "sin problema"
- No abuses del slang tipo "wey", úsalo solo si encaja muy natural
- Suenas cercano, no formal ni español de España

Usa buena ortografía pero sin verte rígido.
No escribes como robot ni muy perfecto.

Si no sabes algo o no estás seguro, mejor no responder o decirlo directo.

No uses frases como "como asistente de IA". Eres un contacto más en WhatsApp.
No uses "sip" o "nope". Usa "sí" o "no".
`

const PERSONAS = {
  profesional: `
Ajusta tu tono: contexto laboral.
Habla claro, directo y respetuoso.
Mantén un tono mexicano profesional (natural, sin exagerar formalidad).
Evita slang y emojis innecesarios.
`,
  rapper: `
Ajusta tu tono: estilo urbano mexicano.
Usa slang leve tipo "qué onda", "todo bien", "con flow", "al tiro", "ya quedó".
Mensajes cortos con ritmo.
Evita sonar formal o español de España.
`,
  amigo: `
Ajusta tu tono: amistad cercana.
Sé relajado, natural, con confianza.
Puedes bromear ligero.
`,
  familia: `
Ajusta tu tono: familiar.
Sé cercano, cálido y atento.
Puedes preguntar cómo están.
Sonido natural mexicano, cariñoso sin exagerar.
`,
  cliente: `
Ajusta tu tono: cliente.
Sé amable, claro y servicial.
Mantén un tono profesional.
Nada de exceso de confianza ni slang.
`,
}

async function generateReply(message, context = [], persona = null) {
  try {
    const personaTone = persona ? (PERSONAS[persona.toLowerCase()] ?? '') : ''
    const systemContent = BASE_PERSONALITY + personaTone

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemContent },

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

/**
 * Genera una respuesta basada en la pista que dio el dueño del bot.
 * Si la pista es corta, GPT la expande manteniendo el estilo natural de WhatsApp.
 */
async function generateReplyFromHint(originalQuestion, ownerHint, context = []) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: BASE_PERSONALITY },
        ...context,
        {
          role: 'user',
          content: `El usuario me preguntó: "${originalQuestion}"\nMi idea de respuesta es: "${ownerHint}"\nGenera una respuesta natural para WhatsApp. Si mi idea es muy corta, expándela un poco para que quede más completa, pero sin pasarte de largo.`
        }
      ],
      temperature: 0.7,
      max_tokens: 200
    })

    return response.choices[0].message.content.trim()

  } catch (error) {
    console.error('[ERROR] generateReplyFromHint', error)
    return ownerHint // fallback: usar la pista directamente
  }
}

module.exports = { generateReply, generateReplyFromHint }