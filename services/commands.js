const { startBot, stopBot, isBotActive } = require('./botState')
const { sendDailyReport } = require('./scheduler')
const { releaseLatestHumanControl, releaseHuman } = require('./conversationState')
const { resolveRecentContactByName } = require('./contactResolver')
const logger = require('./logger')

const PENDING_RESUME_TTL_MS = 5 * 60 * 1000
const pendingResumeByChat = new Map()

function setPendingResume(chatId, options) {
  pendingResumeByChat.set(chatId, {
    options,
    createdAt: Date.now()
  })
}

function getPendingResume(chatId) {
  const pending = pendingResumeByChat.get(chatId)
  if (!pending) return null

  if (Date.now() - pending.createdAt > PENDING_RESUME_TTL_MS) {
    pendingResumeByChat.delete(chatId)
    return null
  }

  return pending
}

function clearPendingResume(chatId) {
  pendingResumeByChat.delete(chatId)
}

function getHelpText() {
  return [
    '📘 *Comandos disponibles*',
    '/start - Activa el bot',
    '/stop - Pone el bot en modo silencioso',
    '/status - Muestra el estado actual del bot',
    '/report - Genera y envia el reporte diario al grupo',
    '/resume - Devuelve al bot el control de la conversacion mas reciente',
    '/resume <nombre> - Devuelve el control al bot para un contacto especifico',
    '/resume 1|2 - Elige una opcion cuando haya ambiguedad',
    '/help - Muestra esta ayuda'
  ].join('\n')
}

async function handleCommand(client, message) {
  const text = message.body.trim()

  if (!text.startsWith('/')) return false

  const [commandToken, ...argParts] = text.split(/\s+/)
  const command = commandToken.toLowerCase()
  const argsText = argParts.join(' ').trim()
  const logCtx = { userId: message.from, conversationId: message.from }

  logger.info(`[COMMAND] Comando recibido: ${command}`, { chatId: message.from })
  logger.categoryMetric('command', 'received', { command }, logCtx)

  switch (command) {
    case '/wbstart':
    case '/start':
      logger.info('[COMMAND] Ejecutando activacion del bot', { chatId: message.from })
      startBot()
      await message.reply('🟢 Bot activado')
      logger.info('[COMMAND] Bot activado correctamente', { chatId: message.from })
      logger.categoryMetric('command', 'success', { command }, logCtx)
      return true

    case '/wbstop':
    case '/stop':
      logger.info('[COMMAND] Ejecutando modo silencioso', { chatId: message.from })
      stopBot()
      await message.reply('🔴 Bot en modo silencioso')
      logger.info('[COMMAND] Bot puesto en modo silencioso', { chatId: message.from })
      logger.categoryMetric('command', 'success', { command }, logCtx)
      return true

    case '/wbstatus':
    case '/status':
      logger.info('[COMMAND] Consultando estado del bot', { chatId: message.from })
      const status = isBotActive() ? '🟢 Activo' : '🔴 Silencioso'
      await message.reply(`📊 Estado actual: ${status}`)
      logger.info(`[COMMAND] Estado reportado: ${status}`, { chatId: message.from })
      logger.categoryMetric('command', 'success', { command, status }, logCtx)
      return true

    case '/wbreport':
    case '/report':
      logger.info('[COMMAND] Generando reporte manual', { chatId: message.from })
      await message.reply('📝 Generando reporte diario...')
      try {
        const sent = await sendDailyReport(client, { title: '📊 *Reporte diario - manual*' })
        if (!sent) {
          logger.warn('[COMMAND] No se encontro el grupo Whatbot para enviar el reporte', { chatId: message.from })
          logger.categoryMetric('command', 'report_group_missing', { command }, logCtx)
          await message.reply('⚠️ No encontré el grupo Whatbot para enviar el reporte')
        } else {
          logger.info('[COMMAND] Reporte manual enviado correctamente', { chatId: message.from })
          logger.categoryMetric('command', 'success', { command }, logCtx)
        }
      } catch (error) {
        logger.error('[COMMAND] Error al generar reporte manual', error, { userId: message.from, conversationId: message.from })
        logger.categoryMetric('command', 'error', { command }, logCtx)
        await message.reply('⚠️ No pude generar el reporte en este momento')
      }
      return true

    case '/wbhelp':
    case '/help':
      logger.info('[COMMAND] Mostrando ayuda de comandos', { chatId: message.from })
      await message.reply(getHelpText())
      logger.info('[COMMAND] Ayuda enviada correctamente', { chatId: message.from })
      logger.categoryMetric('command', 'success', { command }, logCtx)
      return true

    case '/wbresume':
    case '/resume':
      if (argsText === '1' || argsText === '2') {
        const chatId = message.from
        const pending = getPendingResume(chatId)

        if (!pending) {
          logger.info('[COMMAND] No hay seleccion pendiente para resume', { chatId: message.from })
          logger.categoryMetric('command', 'resume_missing_selection', { command }, logCtx)
          await message.reply('ℹ️ No hay una selección pendiente. Usa /resume <nombre> primero')
          return true
        }

        const index = Number(argsText) - 1
        const chosen = pending.options[index]

        if (!chosen) {
          logger.warn('[COMMAND] Opcion de resume fuera de rango', { chatId: message.from, argsText })
          logger.categoryMetric('command', 'resume_invalid_option', { command }, logCtx)
          await message.reply('⚠️ Opción inválida. Usa /resume 1 o /resume 2')
          return true
        }

        try {
          await releaseHuman(chosen.userId)
          clearPendingResume(chatId)
          await message.reply(`✅ Control devuelto al bot para ${chosen.label}`)
          logger.info('[COMMAND] Control devuelto al bot por seleccion numerica', { chatId: message.from, userId: chosen.userId })
          logger.categoryMetric('command', 'success', { command, mode: 'selection' }, logCtx)
        } catch (error) {
          logger.error('[COMMAND] Error al liberar control humano por seleccion', error, { userId: message.from, conversationId: message.from })
          logger.categoryMetric('command', 'error', { command, mode: 'selection' }, logCtx)
          await message.reply('⚠️ No pude devolver el control por selección en este momento')
        }

        return true
      }

      if (argsText) {
        logger.info('[COMMAND] Intentando liberar control humano por nombre', { chatId: message.from, argsText })
        try {
          const result = await resolveRecentContactByName(client, argsText, 10)

          if (result.ambiguous && Array.isArray(result.options) && result.options.length >= 2) {
            const first = result.options[0]
            const second = result.options[1]
            setPendingResume(message.from, result.options.slice(0, 2))
            logger.warn('[COMMAND] Coincidencia ambigua en resume por nombre', { chatId: message.from, argsText })
            logger.categoryMetric('command', 'resume_ambiguous', { command }, logCtx)
            await message.reply(
              `🤔 Encontré dos coincidencias parecidas. ¿Te refieres a:\n1) ${first.label}\n2) ${second.label}\n\nResponde con /resume 1 o /resume 2`
            )
            return true
          }

          if (!result.matched) {
            logger.info('[COMMAND] No se encontro coincidencia por nombre en ultimas conversaciones', { chatId: message.from, argsText })
            logger.categoryMetric('command', 'resume_not_found', { command }, logCtx)
            await message.reply('ℹ️ No encontré una conversación reciente que coincida con ese nombre')
            return true
          }

          await releaseHuman(result.userId)
          await message.reply(`✅ Control devuelto al bot para ${result.label}`)
          logger.info('[COMMAND] Control devuelto al bot por nombre correctamente', { chatId: message.from, userId: result.userId })
          logger.categoryMetric('command', 'success', { command, mode: 'name' }, logCtx)
          return true
        } catch (error) {
          logger.error('[COMMAND] Error al liberar control humano por nombre', error, { userId: message.from, conversationId: message.from })
          logger.categoryMetric('command', 'error', { command, mode: 'name' }, logCtx)
          await message.reply('⚠️ No pude devolver el control por nombre en este momento')
          return true
        }
      }

      logger.info('[COMMAND] Liberando control humano mas reciente', { chatId: message.from })
      try {
        const releasedUser = await releaseLatestHumanControl()
        if (!releasedUser) {
          logger.info('[COMMAND] No habia conversaciones con control humano activo', { chatId: message.from })
          logger.categoryMetric('command', 'resume_none_active', { command }, logCtx)
          await message.reply('ℹ️ No hay conversaciones con control humano activo')
          return true
        }

        await message.reply('✅ Control devuelto al bot en la conversacion mas reciente')
        logger.info('[COMMAND] Control devuelto al bot correctamente', { chatId: message.from })
        logger.categoryMetric('command', 'success', { command, mode: 'latest' }, logCtx)
      } catch (error) {
        logger.error('[COMMAND] Error al liberar control humano', error, { userId: message.from, conversationId: message.from })
        logger.categoryMetric('command', 'error', { command, mode: 'latest' }, logCtx)
        await message.reply('⚠️ No pude devolver el control al bot en este momento')
      }
      return true

    default:
      logger.warn(`[COMMAND] Comando no reconocido: ${command}`, { chatId: message.from })
      logger.categoryMetric('command', 'unknown', { command }, logCtx)
      await message.reply('❓ Comando no reconocido')
      return true
  }
}

module.exports = { handleCommand }