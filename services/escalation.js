// Almacena preguntas que el bot no sabe responder, pendientes de respuesta del dueño
const pendingQuestions = new Map()

/**
 * Agrega una pregunta pendiente para que el dueño la responda desde el grupo Whatbot
 * @param {string} userId - ID de WhatsApp del usuario que preguntó (e.g. 521234567890@c.us)
 * @param {string} content - Mensaje original del usuario
 */
function addPendingQuestion(userId, content) {
  pendingQuestions.set(userId, {
    userId,
    content,
    timestamp: Date.now()
  })
  console.log(`[ESCALATION] Pregunta pendiente registrada de ${userId}`)
}

/**
 * Retorna la pregunta más antigua aún sin responder (FIFO)
 */
function getOldestPendingQuestion() {
  if (pendingQuestions.size === 0) return null
  let oldest = null
  for (const [, data] of pendingQuestions) {
    if (!oldest || data.timestamp < oldest.timestamp) {
      oldest = data
    }
  }
  return oldest
}

/**
 * Elimina la pregunta pendiente de un usuario una vez respondida
 */
function removePendingQuestion(userId) {
  pendingQuestions.delete(userId)
  console.log(`[ESCALATION] Pregunta resuelta para ${userId}`)
}

function hasPendingQuestions() {
  return pendingQuestions.size > 0
}

module.exports = {
  addPendingQuestion,
  getOldestPendingQuestion,
  removePendingQuestion,
  hasPendingQuestions
}
