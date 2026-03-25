async function shouldIgnoreMessage(message, client) {
  if (message.from === 'status@broadcast') {
    console.log('[FILTER] Ignorado: status broadcast')
    return true
  }

  if (message.fromMe) {
    console.log('[FILTER] Ignorado: enviado por mi')
    return true
  }

  if (message.from.includes('@g.us')) {
    console.log('[FILTER] Ignorado: grupo')
    return true
  }

  const normalizeId = (id = '') => id.split('@')[0].replace(/\D/g, '')

  let contact = null
  try {
    contact = await message.getContact()
  } catch (error) {
    console.log('[FILTER] Ignorado: no se pudo obtener contacto')
    return true
  }

  // Regla estricta: solo responder a contactos guardados.
  if (contact?.isMyContact) {
    console.log('[FILTER] Mensaje valido para procesar')
    return false
  }

  // Fallback estricto para diferencias de formato de ID (ej: c.us vs lid).
  // Solo pasa si tambien esta marcado como contacto propio en la libreta.
  let contacts = []
  try {
    contacts = await client.getContacts()
  } catch (error) {
    console.log('[FILTER] Ignorado: no se pudo consultar libreta de contactos')
    return true
  }

  const incomingId = normalizeId(message.from)
  const inMyContacts = contacts.some(c => c?.isMyContact && normalizeId(c?.id?._serialized || '') === incomingId)

  if (!inMyContacts) {
    console.log('[FILTER] Ignorado: numero no guardado en contactos')
    return true
  }

  console.log('[FILTER] Mensaje valido para procesar')
  return false
}

module.exports = { shouldIgnoreMessage }