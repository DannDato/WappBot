const { startBot, stopBot } = require('./botState')

async function handleCommand(message) {
  const text = message.body.trim()
    
  if (!text.startsWith('/')) return false

  switch (text) {
    case '/wbstart':
      startBot()
      await message.reply('🟢 Bot activado')
      return true

    case '/wbstop':
      stopBot()
      await message.reply('🔴 Bot en modo silencioso')
      return true

    case '/wbstatus':
      const status = global.botActive ? '🟢 Activo' : '🔴 Silencioso'
      await message.reply(`📊 Estado actual: ${status}`)
      return true
    default:
      await message.reply('❓ Comando no reconocido')
      return true
  }
}

module.exports = { handleCommand }