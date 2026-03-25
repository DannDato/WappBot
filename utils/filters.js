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

  let contact = null
  try {
    contact = await message.getContact()
  } catch (error) {
    console.log('[FILTER] No se pudo obtener contacto, se permite continuar')
    return false
  }

  // En algunas cuentas (LID/MD), los ids pueden no coincidir entre message.from y getContacts.
  // Consideramos valido si WhatsApp reporta contacto propio o si hay nombre/pushname.
  const hasKnownName = Boolean(contact?.name || contact?.pushname)
  const looksLikeMyContact = Boolean(contact?.isMyContact) || hasKnownName

  if (!looksLikeMyContact) {
    console.log('[FILTER] Ignorado: contacto no reconocido')
    return true
  }

  console.log('[FILTER] Mensaje valido para procesar')
  return false
}

module.exports = { shouldIgnoreMessage }