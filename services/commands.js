const { startBot, stopBot, isBotActive } = require('./botState')
const { sendDailyReport } = require('./scheduler')
const { releaseLatestHumanControl, releaseHuman } = require('./conversationState')
const { resolveRecentContactByName } = require('./contactResolver')

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

  console.log(`[COMMAND] Comando recibido: ${command}`)

  switch (command) {
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

    case '/wbresume':
    case '/resume':
      if (argsText === '1' || argsText === '2') {
        const chatId = message.from
        const pending = getPendingResume(chatId)

        if (!pending) {
          console.log('[COMMAND] No hay seleccion pendiente para resume')
          await message.reply('ℹ️ No hay una selección pendiente. Usa /resume <nombre> primero')
          return true
        }

        const index = Number(argsText) - 1
        const chosen = pending.options[index]

        if (!chosen) {
          console.log('[COMMAND] Opcion de resume fuera de rango')
          await message.reply('⚠️ Opción inválida. Usa /resume 1 o /resume 2')
          return true
        }

        try {
          await releaseHuman(chosen.userId)
          clearPendingResume(chatId)
          await message.reply(`✅ Control devuelto al bot para ${chosen.label}`)
          console.log('[COMMAND] Control devuelto al bot por seleccion numerica')
        } catch (error) {
          console.error('[COMMAND] Error al liberar control humano por seleccion', error)
          await message.reply('⚠️ No pude devolver el control por selección en este momento')
        }

        return true
      }

      if (argsText) {
        console.log('[COMMAND] Intentando liberar control humano por nombre')
        try {
          const result = await resolveRecentContactByName(client, argsText, 10)

          if (result.ambiguous && Array.isArray(result.options) && result.options.length >= 2) {
            const first = result.options[0]
            const second = result.options[1]
            setPendingResume(message.from, result.options.slice(0, 2))
            console.log('[COMMAND] Coincidencia ambigua en resume por nombre')
            await message.reply(
              `🤔 Encontré dos coincidencias parecidas. ¿Te refieres a:\n1) ${first.label}\n2) ${second.label}\n\nResponde con /resume 1 o /resume 2`
            )
            return true
          }

          if (!result.matched) {
            console.log('[COMMAND] No se encontro coincidencia por nombre en ultimas conversaciones')
            await message.reply('ℹ️ No encontré una conversación reciente que coincida con ese nombre')
            return true
          }

          await releaseHuman(result.userId)
          await message.reply(`✅ Control devuelto al bot para ${result.label}`)
          console.log('[COMMAND] Control devuelto al bot por nombre correctamente')
          return true
        } catch (error) {
          console.error('[COMMAND] Error al liberar control humano por nombre', error)
          await message.reply('⚠️ No pude devolver el control por nombre en este momento')
          return true
        }
      }

      console.log('[COMMAND] Liberando control humano mas reciente')
      try {
        const releasedUser = await releaseLatestHumanControl()
        if (!releasedUser) {
          console.log('[COMMAND] No habia conversaciones con control humano activo')
          await message.reply('ℹ️ No hay conversaciones con control humano activo')
          return true
        }

        await message.reply('✅ Control devuelto al bot en la conversacion mas reciente')
        console.log('[COMMAND] Control devuelto al bot correctamente')
      } catch (error) {
        console.error('[COMMAND] Error al liberar control humano', error)
        await message.reply('⚠️ No pude devolver el control al bot en este momento')
      }
      return true

    default:
      console.warn(`[COMMAND] Comando no reconocido: ${command}`)
      await message.reply('❓ Comando no reconocido')
      return true
  }
}

module.exports = { handleCommand }