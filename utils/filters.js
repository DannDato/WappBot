async function shouldIgnoreMessage(message) {

    const contact = await message.getContact()

    if (!contact.isMyContact) return true

    if (message.fromMe) return true

    if (message.from.includes('@g.us')) return true

    if (message.from === 'status@broadcast') return true

    
  return false
}

module.exports = { shouldIgnoreMessage }