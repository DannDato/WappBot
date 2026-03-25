const { startBot, stopBot, isBotActive } = require('./botState')
const { sendDailyReport } = require('./scheduler')

function getHelpText() {
  return [
    '📘 *Comandos disponibles*',
    '/start - Activa el bot',
    '/stop - Pone el bot en modo silencioso',
    '/status - Muestra el estado actual del bot',
    '/report - Genera y envia el reporte diario al grupo',
    '/help - Muestra esta ayuda'
  ].join('\n')
}

async function handleCommand(client, message) {
  const text = message.body.trim()

  if (!text.startsWith('/')) return false

  const normalized = text.toLowerCase()
  console.log(`[COMMAND] Comando recibido: ${normalized}`)

  switch (normalized) {
    case '/wbstart':
    case '/start':
      console.log('[COMMAND] Ejecutando activacion del bot')
      startBot()
      await message.reply('🟢 Bot activado')
      console.log('[COMMAND] Bot activado correctamente')
      return true

    case '/wbstop':
    case '/stop':
      console.log('[COMMAND] Ejecutando modo silencioso')
      stopBot()
      await message.reply('🔴 Bot en modo silencioso')
      console.log('[COMMAND] Bot puesto en modo silencioso')
      return true

    case '/wbstatus':
    case '/status':
      console.log('[COMMAND] Consultando estado del bot')
      const status = isBotActive() ? '🟢 Activo' : '🔴 Silencioso'
      await message.reply(`📊 Estado actual: ${status}`)
      console.log(`[COMMAND] Estado reportado: ${status}`)
      return true

    case '/wbreport':
    case '/report':
      console.log('[COMMAND] Generando reporte manual')
      await message.reply('📝 Generando reporte diario...')
      try {
        const sent = await sendDailyReport(client, { title: '📊 *Reporte diario - manual*' })
        if (!sent) {
          console.warn('[COMMAND] No se encontro el grupo Whatbot para enviar el reporte')
          await message.reply('⚠️ No encontré el grupo Whatbot para enviar el reporte')
        } else {
          console.log('[COMMAND] Reporte manual enviado correctamente')
        }
      } catch (error) {
        console.error('[COMMAND] Error al generar reporte manual', error)
        await message.reply('⚠️ No pude generar el reporte en este momento')
      }
      return true

    case '/wbhelp':
    case '/help':
      console.log('[COMMAND] Mostrando ayuda de comandos')
      await message.reply(getHelpText())
      console.log('[COMMAND] Ayuda enviada correctamente')
      return true

    default:
      console.warn(`[COMMAND] Comando no reconocido: ${normalized}`)
      await message.reply('❓ Comando no reconocido')
      return true
  }
}

module.exports = { handleCommand }