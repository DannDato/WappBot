// Almacena preguntas que el bot no sabe responder, pendientes de respuesta del dueño
// Se indexa por ID de escalacion para evitar cruces de destino cuando hay multiples pendientes.
const logger = require('./logger')
const pendingQuestions = new Map()
const escalationMessageIndex = new Map()

function buildEscalationId() {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${ts}${rand}`
}

/**
 * Agrega una pregunta pendiente para que el dueño la responda desde el grupo Whatbot
 * @param {string} userId - ID de WhatsApp del usuario que preguntó (e.g. 521234567890@c.us)
 * @param {string} content - Mensaje original del usuario
 */
function addPendingQuestion(userId, content, meta = {}) {
  const escalationId = buildEscalationId()
  pendingQuestions.set(escalationId, {
    escalationId,
    userId,
    content,
    contactName: meta.contactName || null,
    timestamp: Date.now()
  })
  logger.info(`[ESCALATION] Pregunta pendiente registrada de ${userId} con ID ${escalationId}`, { userId, escalationId }, { userId, conversationId: userId })
  logger.categoryMetric('escalation', 'pending_added', {}, { userId, conversationId: userId })
  return escalationId
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

function getPendingQuestionById(escalationId) {
  if (!escalationId) return null
  return pendingQuestions.get(String(escalationId).trim().toUpperCase()) || null
}

function normalizeMessageId(messageId) {
  if (!messageId) return null
  if (typeof messageId === 'string') return messageId.trim()
  if (typeof messageId === 'object') {
    if (messageId._serialized) return String(messageId._serialized).trim()
    if (messageId.id) return String(messageId.id).trim()
  }
  return String(messageId).trim()
}

function attachEscalationMessageId(escalationId, messageId) {
  const key = String(escalationId || '').trim().toUpperCase()
  const normalizedMessageId = normalizeMessageId(messageId)
  if (!key || !normalizedMessageId) {
    logger.categoryMetric('escalation', 'attach_invalid')
    return false
  }

  const pending = pendingQuestions.get(key)
  if (!pending) {
    logger.categoryMetric('escalation', 'attach_missing_pending')
    return false
  }

  pending.escalationMessageId = normalizedMessageId
  escalationMessageIndex.set(normalizedMessageId, key)
  logger.categoryMetric('escalation', 'attach_success', {}, { userId: pending.userId, conversationId: pending.userId })
  return true
}

function getPendingQuestionByMessageId(messageId) {
  const normalizedMessageId = normalizeMessageId(messageId)
  if (!normalizedMessageId) return null
  const escalationId = escalationMessageIndex.get(normalizedMessageId)
  if (!escalationId) return null
  return pendingQuestions.get(escalationId) || null
}

function getPendingCount() {
  return pendingQuestions.size
}

function listPendingQuestions(limit = 10) {
  const items = Array.from(pendingQuestions.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, limit)
  return items
}

/**
 * Elimina la pregunta pendiente de un usuario una vez respondida
 */
function removePendingQuestion(identifier) {
  if (!identifier) return false
  const key = String(identifier).trim().toUpperCase()

  if (pendingQuestions.has(key)) {
    const pending = pendingQuestions.get(key)
    if (pending?.escalationMessageId) {
      escalationMessageIndex.delete(pending.escalationMessageId)
    }
    pendingQuestions.delete(key)
    logger.info(`[ESCALATION] Pregunta resuelta para ${pending.userId} (ID ${key})`, { userId: pending.userId, escalationId: key }, { userId: pending.userId, conversationId: pending.userId })
    logger.categoryMetric('escalation', 'resolved', {}, { userId: pending.userId, conversationId: pending.userId })
    return true
  }

  for (const [escalationId, data] of pendingQuestions) {
    if (data.userId === identifier) {
      if (data?.escalationMessageId) {
        escalationMessageIndex.delete(data.escalationMessageId)
      }
      pendingQuestions.delete(escalationId)
      logger.info(`[ESCALATION] Pregunta resuelta para ${identifier} (ID ${escalationId})`, { userId: identifier, escalationId }, { userId: identifier, conversationId: identifier })
      logger.categoryMetric('escalation', 'resolved', {}, { userId: identifier, conversationId: identifier })
      return true
    }
  }

  return false
}

function hasPendingQuestions() {
  return pendingQuestions.size > 0
}

module.exports = {
  addPendingQuestion,
  attachEscalationMessageId,
  getOldestPendingQuestion,
  getPendingQuestionById,
  getPendingQuestionByMessageId,
  getPendingCount,
  listPendingQuestions,
  removePendingQuestion,
  hasPendingQuestions
}
