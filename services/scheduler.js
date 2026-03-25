const cron = require('node-cron')
const { getDailyMessages, generateSummary } = require('./report')

const REPORT_TIMEZONE = 'America/Mexico_City'

async function buildContactLabels(client, messages) {
  const userIds = [...new Set(messages.map(message => message.user_id))]
  const entries = await Promise.all(
    userIds.map(async (userId) => {
      try {
        const contact = await client.getContactById(userId)
        const label = contact.pushname || contact.name || userId.replace('@c.us', '')
        return [userId, label]
      } catch (_) {
        return [userId, userId.replace('@c.us', '')]
      }
    })
  )

  return Object.fromEntries(entries)
}

async function sendDailyReport(client, options = {}) {
  const title = options.title || '📊 *Reporte diario - 9:00 PM*'

  const messages = await getDailyMessages()
  const contactLabels = await buildContactLabels(client, messages)
  const summary = await generateSummary(messages, contactLabels)

  const chats = await client.getChats()

  const whatbotGroup = chats.find(
    c => c.isGroup && c.name?.toLowerCase() === 'whatbot'
  )

  if (!whatbotGroup) {
    console.log('[REPORT] Grupo WhatBot no encontrado, no se puede enviar el reporte diario')
    return false
  }

  await client.sendMessage(
    whatbotGroup.id._serialized,
    `${title}\n\n${summary}`
  )

  console.log('[REPORT] Reporte diario enviado al grupo WhatBot')
  return true
}

async function startScheduler(client) {
  // Todos los dias a las 9:00 PM hora de Mexico central
  cron.schedule('0 21 * * *', async () => {
    console.log('[REPORT] Generando reporte diario')

    try {
      await sendDailyReport(client)

    } catch (error) {
      console.error('[ERROR] Error al generar o enviar el reporte diario', error)
    }
  }, {
    timezone: REPORT_TIMEZONE
  })
}

module.exports = { startScheduler, sendDailyReport }