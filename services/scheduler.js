const cron = require('node-cron')
const { getDailyMessages, generateReportBody } = require('./report')
const logger = require('./logger')
const { runDailyMaintenance } = require('./maintenance')

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
  logger.categoryMetric('report', 'build_started', { manual: Boolean(options.title) })

  const messages = await getDailyMessages()
  const contactLabels = await buildContactLabels(client, messages)
  const summary = await generateReportBody(messages, contactLabels)

  const chats = await client.getChats()

  const whatbotGroup = chats.find(
    c => c.isGroup && c.name?.toLowerCase() === 'whatbot'
  )

  if (!whatbotGroup) {
    logger.warn('[REPORT] Grupo WhatBot no encontrado, no se puede enviar el reporte diario')
    logger.categoryMetric('report', 'group_missing')
    return false
  }

  await client.sendMessage(
    whatbotGroup.id._serialized,
    `${title}\n\n${summary}`
  )

  logger.info('[REPORT] Reporte diario enviado al grupo WhatBot', { messageCount: messages.length })
  logger.categoryMetric('report', 'sent', { messageCount: messages.length })
  return true
}

async function startScheduler(client) {
  // Ejecutar una vez al iniciar para no esperar al siguiente ciclo
  try {
    logger.info('[MAINTENANCE] Ejecutando limpieza inicial al arranque')
    await runDailyMaintenance()
  } catch (error) {
    logger.error('[MAINTENANCE] Error en limpieza inicial al arranque', error)
  }

  // Limpieza diaria a las 2:30 AM hora de Mexico central
  cron.schedule('30 2 * * *', async () => {
    logger.info('[MAINTENANCE] Ejecutando limpieza diaria programada')

    try {
      await runDailyMaintenance()
    } catch (error) {
      logger.error('[MAINTENANCE] Error al ejecutar limpieza diaria programada', error)
    }
  }, {
    timezone: REPORT_TIMEZONE
  })

  // Todos los dias a las 9:00 PM hora de Mexico central
  cron.schedule('0 21 * * *', async () => {
    logger.info('[REPORT] Generando reporte diario')
    logger.categoryMetric('report', 'scheduled_trigger')

    try {
      await sendDailyReport(client)

    } catch (error) {
      logger.error('[ERROR] Error al generar o enviar el reporte diario', error)
      logger.categoryMetric('report', 'error')
    }
  }, {
    timezone: REPORT_TIMEZONE
  })
}

module.exports = { startScheduler, sendDailyReport }