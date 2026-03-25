const logger = require('../services/logger')

async function shouldIgnoreMessage(message, client) {
  if (message.from === 'status@broadcast') {
    logger.info('[FILTER] Ignorado: status broadcast')
    logger.categoryMetric('filter', 'ignored_status_broadcast')
    return true
  }

  if (message.fromMe) {
    logger.info('[FILTER] Ignorado: enviado por mi')
    logger.categoryMetric('filter', 'ignored_from_me')
    return true
  }

  if (message.from.includes('@g.us')) {
    logger.info('[FILTER] Ignorado: grupo')
    logger.categoryMetric('filter', 'ignored_group')
    return true
  }

  const normalizeId = (id = '') => id.split('@')[0].replace(/\D/g, '')

  let contact = null
  try {
    contact = await message.getContact()
  } catch (error) {
    logger.warn('[FILTER] Ignorado: no se pudo obtener contacto', { reason: error.message || String(error) })
    logger.categoryMetric('filter', 'contact_lookup_error')
    return true
  }

  // Regla estricta: solo responder a contactos guardados.
  if (contact?.isMyContact) {
    logger.info('[FILTER] Mensaje valido para procesar', { userId: message.from })
    logger.categoryMetric('filter', 'accepted_direct_contact', {}, { userId: message.from, conversationId: message.from })
    return false
  }

  // Fallback estricto para diferencias de formato de ID (ej: c.us vs lid).
  // Solo pasa si tambien esta marcado como contacto propio en la libreta.
  let contacts = []
  try {
    contacts = await client.getContacts()
  } catch (error) {
    logger.warn('[FILTER] Ignorado: no se pudo consultar libreta de contactos', { reason: error.message || String(error) })
    logger.categoryMetric('filter', 'contacts_lookup_error')
    return true
  }

  const incomingId = normalizeId(message.from)
  const inMyContacts = contacts.some(c => c?.isMyContact && normalizeId(c?.id?._serialized || '') === incomingId)

  if (!inMyContacts) {
    logger.info('[FILTER] Ignorado: numero no guardado en contactos', { userId: message.from })
    logger.categoryMetric('filter', 'ignored_not_in_contacts', {}, { userId: message.from, conversationId: message.from })
    return true
  }

  logger.info('[FILTER] Mensaje valido para procesar', { userId: message.from })
  logger.categoryMetric('filter', 'accepted_fallback_contact', {}, { userId: message.from, conversationId: message.from })
  return false
}

module.exports = { shouldIgnoreMessage }