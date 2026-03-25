const OpenAI = require('openai')
const logger = require('./logger')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

async function decideReply(message, context = []) {
  try {
    logger.info('[DECISION] Analizando mensaje para decidir accion', { contextCount: context.length })
    logger.categoryMetric('decision', 'analyze', { contextCount: context.length })

    // Formatear historial como texto para que el clasificador lo analice como datos
    const historyText = context.length > 0
      ? context.slice(-8).map(m => `${m.role === 'user' ? 'Usuario' : 'Bot'}: ${m.content}`).join('\n')
      : 'Sin historial previo.'

    const prompt = `
Eres un sistema que decide si un bot de WhatsApp debe responder o no.

--- HISTORIAL RECIENTE DE LA CONVERSACIÓN ---
${historyText}
--- FIN DEL HISTORIAL ---

Mensaje nuevo del usuario:
"${message}"

Primero analiza el historial:
- ¿El bot ya estaba participando activamente en esta conversación sobre este mismo tema?
- ¿El mensaje nuevo es una continuación natural de ese hilo, o es un tema completamente distinto?

Si ES continuación de una conversación donde el bot ya participaba y el tema sigue siendo seguro → el bot DEBE seguir respondiendo para no romper el hilo de forma abrupta.
Si NO es continuación → evaluar el mensaje de forma independiente con las reglas de abajo.

Reglas IMPORTANTES (aplican siempre):
- NO responder si el mensaje pregunta por la ubicación, estado o actividad actual del dueño en tiempo real: "¿ya llegaste?", "¿ya andas en tu casa?", "¿dónde estás?", . El bot NO sabe eso. Marca askHuman=true.
- NO responder si el mensaje es muy personal, confidencial, o claramente requiere a un humano
- NO responder si se necesita información de proyectos o tareas específicas del dueño
- NO responder a mensajes tipo: "luego te digo", "te marco", "oye tú"
- Si te piden agendar algo, un plan, salida, reunion, trabajo o lo que sea, pide siempre detalles como fecha, hora, lugar y personas involucradas para tener claro el contexto. Si no te dan esos detalles, NO respondas y marca askHuman=true.
- Si ya te dieron detalles para agendar NO respondas y marca askHuman=true, porque el bot no puede gestionar agendas ni compromisos reales, eso siempre lo debe manejar un humano.
- Si es una pregunta que puedes resolver con conocimiento general contesta marca shouldReply=true,

Responde ÚNICAMENTE en JSON válido:
{
  "shouldReply": true/false,
  "confidence": 0-1,
  "askHuman": true/false,
  "isContinuation": true/false,
  "reason": "explicación corta"
}
`

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'Eres un clasificador estricto de mensajes de WhatsApp. Solo respondes JSON válido.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 150
    })

    const text = response.choices[0].message.content.trim()

    try {
      const decision = JSON.parse(text)

      if (decision.shouldReply) {
        logger.info('[DECISION] Resultado: responder', { decision })
        logger.categoryMetric('decision', 'result_reply', { askHuman: Boolean(decision.askHuman), continuation: Boolean(decision.isContinuation) })
      } else if (decision.askHuman && !decision.shouldReply) {
        logger.info('[DECISION] Resultado: esperar y escalar a humano', { decision })
        logger.categoryMetric('decision', 'result_escalate', { continuation: Boolean(decision.isContinuation) })
      } else {
        logger.info('[DECISION] Resultado: esperar (sin respuesta)', { decision })
        logger.categoryMetric('decision', 'result_wait', { continuation: Boolean(decision.isContinuation) })
      }
      return decision

    } catch (err) {
      logger.warn('[DECISION] Respuesta no es JSON valido, se fuerza escalamiento a humano', { raw: text })
      logger.categoryMetric('decision', 'parse_error')
      return { shouldReply: false, confidence: 0, askHuman: true, reason: 'parse_error' }
    }

  } catch (error) {
    logger.error('[ERROR] Error al decidir respuesta', error)
    logger.categoryMetric('decision', 'error')
    return { shouldReply: false, confidence: 0, askHuman: true, reason: 'error' }
  }
}

module.exports = { decideReply }