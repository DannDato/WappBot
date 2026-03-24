const cron = require('node-cron')
const { getRecentMessages, generateSummary } = require('./report')

async function startScheduler(client) {
  // ⏱️ cada 4 horas
  cron.schedule('0 */4 * * *', async () => {
    console.log('[REPORT] Generando resumen de actividad...')

    try {
      const messages = await getRecentMessages()
      const summary = await generateSummary(messages)

      const chats = await client.getChats()

      const whatbotGroup = chats.find(
        c => c.isGroup && c.name?.toLowerCase() === 'whatbot'
      )

      if (!whatbotGroup) {
        console.log('[REPORT] Grupo WhatBot no encontrado, no se puede enviar el resumen')
        return
      }

      await client.sendMessage(
        whatbotGroup.id._serialized,
        `📊 *Resumen (últimas 4 horas)*\n\n${summary}`
      )

      console.log('[REPORT] Resumen enviado al grupo WhatBot')

    } catch (error) {
      console.error('[ERROR] Error al generar o enviar el resumen', error)
    }
  })
}

module.exports = { startScheduler }