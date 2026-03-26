require('dotenv').config()

const qrcode = require('qrcode-terminal')
const { Client, LocalAuth } = require('whatsapp-web.js')
const { handleMessage } = require('./handlers/messageHandler')
const { saveLearning } = require('./services/learning')
const { getLastUserMessage, getContext, saveMessage } = require('./services/memory')
const { handleCommand } = require('./services/commands')
const { markHumanActive, isHumanActive, releaseHuman } = require('./services/conversationState')
const { startScheduler } = require('./services/scheduler')
const { isBotMessage, addBotMessage } = require('./services/botMessages')
const {
  hasPendingQuestions,
  getPendingQuestionByMessageId,
  getOldestPendingQuestion,
  getPendingQuestionById,
  getPendingCount,
  listPendingQuestions,
  removePendingQuestion
} = require('./services/escalation')
const { generateReplyFromHint } = require('./services/openai')
const { parseOwnerInstruction, saveOwnerInstruction } = require('./services/ownerInstructions')
const db = require('./services/db')
const logger = require('./services/logger')

const os = require('os')

function isTransientContextError(error) {
  if (!error) return false
  const msg = String(error.message || error)
  return msg.includes('Execution context was destroyed') || msg.includes('Cannot find context with specified id')
}

let isReinitializing = false
const unreadCountCache = new Map()
const UNREAD_POLL_INTERVAL_MS = 8000

function extractEscalationId(text = '') {
  const match = String(text).match(/#([A-Z0-9]{6,})|\[ID:([A-Z0-9]{6,})\]/i)
  if (!match) return null
  return (match[1] || match[2] || '').toUpperCase()
}

async function processUnreadSignal(chat, source = 'event') {
  const chatId = chat?.id?._serialized
  if (!chatId) return
  if (chatId === 'status@broadcast') return
  if (chatId.includes('@g.us')) return

  const currentUnread = Number(chat?.unreadCount ?? 0)
  const previousUnread = unreadCountCache.has(chatId) ? unreadCountCache.get(chatId) : null
  unreadCountCache.set(chatId, currentUnread)

  // Solo tomar como "marcado manual no leido" (badge sin contador)
  // cuando el contador queda negativo, NO cuando sube por mensajes nuevos.
  const isManualMarkedUnread = currentUnread < 0 && (previousUnread === null || previousUnread >= 0)
  if (!isManualMarkedUnread) return

  const humanActive = await Promise.race([
    isHumanActive(chatId),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:isHumanActiveUnread')), 4000))
  ])

  if (!humanActive){
    logger.info('[CONTROL] Marcado como no leido detectada. No se necesita liberar control.', { source, chatId }, { userId: chatId, conversationId: chatId })
    return
  } 

  await Promise.race([
    releaseHuman(chatId),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:releaseHumanUnread')), 4000))
  ])

  logger.info(`[CONTROL] Conversacion marcada como no leida detectada por ${source}: control devuelto al bot`, { source, chatId }, { userId: chatId, conversationId: chatId })
}

function startUnreadPoller(client) {
  setInterval(async () => {
    try {
      const chats = await client.getChats()
      for (const chat of chats) {
        await processUnreadSignal(chat, 'poller')
      }
    } catch (error) {
      logger.warn('[CONTROL] Error en sondeo unread', { reason: error.message || String(error) })
    }
  }, UNREAD_POLL_INTERVAL_MS)
}

async function reinitializeClient(client, reason = 'unknown') {
  if (isReinitializing) return
  isReinitializing = true

  try {
    logger.warn('[RECOVERY] Reintentando sesion de WhatsApp', { reason })
    try {
      await client.destroy()
    } catch (_) {}

    await new Promise(resolve => setTimeout(resolve, 3000))
    await client.initialize()
    logger.info('[RECOVERY] Reconexion solicitada correctamente', { reason })
  } catch (err) {
    logger.error('[RECOVERY] Error al reintentar inicializacion', err)
  } finally {
    isReinitializing = false
  }
}

process.on('unhandledRejection', (reason) => {
  if (isTransientContextError(reason)) {
    logger.warn('[WARN] Error transitorio de contexto detectado (unhandledRejection). Se ignora para evitar caida.')
    return
  }

  logger.error('[PROCESS] unhandledRejection', reason)
})

process.on('uncaughtException', (error) => {
  if (isTransientContextError(error)) {
    logger.warn('[WARN] Error transitorio de contexto detectado (uncaughtException). Se ignora para evitar caida.')
    return
  }

  logger.error('[PROCESS] uncaughtException', error)
})

let puppeteerConfig = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
}

// 🧠 Detectar sistema
const platform = process.platform

if (platform === 'linux') {
  logger.info('[SYSTEM] Sistema detectado: Linux')

  puppeteerConfig = {
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  }

} else if (platform === 'win32') {
  logger.info('[SYSTEM] Sistema detectado: Windows')

  puppeteerConfig = {
    headless: true,
    // Windows normalmente ya encuentra Chrome solo
    args: ['--no-sandbox']
  }

} else if (platform === 'darwin') {
  logger.info('[SYSTEM] Sistema detectado: macOS')

  puppeteerConfig = {
    headless: true
  }
}

// Crear cliente
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: puppeteerConfig
})

client.on('qr', (qr) => {
  logger.info('[AUTH] QR generado para autenticacion')
  qrcode.generate(qr, { small: true })
})

client.on('ready', () => {
  logger.info('[BOT] WhatBot listo')
  startScheduler(client)
  startUnreadPoller(client)
})

client.on('authenticated', () => {
  logger.info('[AUTH] Sesion autenticada')
})

client.on('auth_failure', (msg) => {
  logger.error('[AUTH] Fallo de autenticacion', new Error(String(msg || 'auth_failure')))
  reinitializeClient(client, 'auth_failure')
})

client.on('change_state', (state) => {
  logger.info('[STATE] Estado del cliente', { state })
})

client.on('unread_count', async (chat) => {
  try {
    await processUnreadSignal(chat, 'unread_count')
  } catch (error) {
    logger.warn('[CONTROL] No se pudo procesar unread_count para liberar control humano', { reason: error.message || String(error) })
  }
})

client.on('disconnected', (reason) => {
  logger.error('[STATE] Cliente desconectado', new Error(String(reason || 'disconnected')))
  reinitializeClient(client, 'disconnected')
})

client.on('message', async (message) => {
  try {
    if (message.from === 'status@broadcast') return

    const logCtx = { userId: message.from, conversationId: message.from }

    logger.infoIncomingMessage('[EVENT] message recibido', { messageId: message.id?._serialized || null }, logCtx)
    logger.categoryMetric('event', 'message_received', {}, logCtx)
    const chat = await message.getChat()
    const isContact = chat.isGroup ? null : await chat.getContact()
    
    // si no está en mis contactos no contesta
    if(!isContact) {
      logger.info('[EVENT] descartado: chat sin contacto directo', {}, logCtx)
      logger.categoryMetric('event', 'ignored_no_contact', {}, logCtx)
      return
    }
    // ignora mensajes del bot
    if (message.fromMe) {
      logger.info('[EVENT] descartado: fromMe', {}, logCtx)
      logger.categoryMetric('event', 'ignored_from_me', {}, logCtx)
      return
    }

    // ignorar grupos
    if (message.from.includes('@g.us')) {
      logger.info('[EVENT] descartado: grupo', {}, logCtx)
      logger.categoryMetric('event', 'ignored_group', {}, logCtx)
      return
    }

    //manejamos ahora si el mensaje
    logger.info('[EVENT] enviando a handleMessage', {}, logCtx)
    await handleMessage(client, message)

  } catch (error) {
    if (isTransientContextError(error)) {
      logger.warn('[WARN] Error transitorio al manejar message. Se omite este evento.', { reason: error.message || String(error) })
      logger.categoryMetric('event', 'transient_error', {}, { userId: message.from, conversationId: message.from })
      return
    }
    logger.error('[ERROR] Error al manejar el mensaje', error, { userId: message.from, conversationId: message.from })
    logger.categoryMetric('event', 'message_error', {}, { userId: message.from, conversationId: message.from })
  }
})

client.on('message_create', async (message) => {
  try {
    if (message.from === 'status@broadcast') return

    if (!message.fromMe) return
    const chat = await message.getChat()
    const logCtx = { userId: chat.id?._serialized || message.from, conversationId: chat.id?._serialized || message.from }

    const isCommandGroup = chat.isGroup && chat.name?.toLowerCase() === 'whatbot'
    const isContact = chat.isGroup ? null : await chat.getContact()
    // Permitir mensajes del grupo Whatbot aunque no sea un contacto individual
    if (!isContact && !isCommandGroup) return

    logger.infoIncomingMessage('[MESSAGE] Nuevo mensaje creado', { messageId: message.id?._serialized || null }, logCtx)
    logger.categoryMetric('message', 'created', {}, logCtx)

    // IGNORAR mensajes del bot
    if (isBotMessage(message.body)) {
      logger.info('[MESSAGE] Mensaje del bot ignorado', {}, logCtx)
      logger.categoryMetric('message', 'ignored_bot', {}, logCtx)
      return
    }

    // COMANDOS
    if (isCommandGroup && message.body.startsWith('/')) {
      const handled = await handleCommand(client, message)
      if (handled) return
    }

    // INSTRUCCIONES TEMPORALES: "si pregunta X sobre Y dile que Z"
    if (isCommandGroup) {
      const parsedInstruction = parseOwnerInstruction(message.body)
      if (parsedInstruction) {
        try {
          const saveResult = await Promise.race([
            saveOwnerInstruction(client, message.body),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:saveOwnerInstruction')), 8000))
          ])

          if (!saveResult?.ok) {
            if (saveResult?.reason === 'ambiguous_contact' && Array.isArray(saveResult?.resolveResult?.options)) {
              logger.categoryMetric('instruction', 'ambiguous_contact', {}, logCtx)
              const options = saveResult.resolveResult.options
                .slice(0, 2)
                .map((opt, idx) => `${idx + 1}) ${opt.label}`)
                .join('\n')
              const ambiguousMsg = `⚠️ Instruccion detectada, pero el contacto es ambiguo. Intenta con el nombre completo.\nOpciones probables:\n${options}`
              addBotMessage(ambiguousMsg)
              await Promise.race([
                message.reply(ambiguousMsg),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:ownerInstructionAmbiguousReply')), 8000))
              ])
              return
            }

            const failMsg = '⚠️ No pude guardar la instruccion. Verifica el nombre del contacto y vuelve a intentar.'
            logger.categoryMetric('instruction', 'save_failed', { reason: saveResult?.reason || 'unknown' }, logCtx)
            addBotMessage(failMsg)
            await Promise.race([
              message.reply(failMsg),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:ownerInstructionFailReply')), 8000))
            ])
            return
          }

          const info = saveResult.instruction
          logger.categoryMetric('instruction', 'saved', { topic: info.topic }, logCtx)
          const okMsg = `✅ Instruccion guardada para ${info.contactLabel || info.userId.replace('@c.us', '')}.\nTema: "${info.topic}"\nCaduca: ${new Date(info.expiresAt).toLocaleString('es-MX')}`
          addBotMessage(okMsg)
          await Promise.race([
            message.reply(okMsg),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:ownerInstructionOkReply')), 8000))
          ])
        } catch (instructionErr) {
          logger.error('[INSTRUCTION] Error al guardar instruccion temporal', instructionErr, logCtx)
          logger.categoryMetric('instruction', 'error', {}, logCtx)
          const errorMsg = '⚠️ Hubo un error guardando la instruccion temporal.'
          addBotMessage(errorMsg)
          await Promise.race([
            message.reply(errorMsg),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:ownerInstructionErrorReply')), 8000))
          ])
        }
        return
      }
    }
    //  no aprender comandos
    if (message.body.startsWith('/')) return

    // ESCALATION: si el dueño responde en el grupo Whatbot y hay preguntas pendientes, contestar al usuario
    if (isCommandGroup && hasPendingQuestions()) {
      logger.info('[ESCALATION] Respondiendo a pregunta pendiente', {}, logCtx)
      logger.categoryMetric('escalation', 'reply_flow_started', {}, logCtx)
      const messageText = String(message.body || '').trim()
      const explicitId = extractEscalationId(messageText)
      let pending = null

      if (explicitId) {
        pending = getPendingQuestionById(explicitId)
        if (!pending) {
          const invalidIdMsg = `⚠️ No encontré pendiente con ID ${explicitId}. Usa el ID que aparece en el mensaje de escalación.`
          addBotMessage(invalidIdMsg)
          await Promise.race([
            message.reply(invalidIdMsg),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:invalidEscalationIdReply')), 8000))
          ])
          return
        }
      }

      if (!pending) {
        try {
          if (message.hasQuotedMsg) {
            const quoted = await message.getQuotedMessage()
            pending = getPendingQuestionByMessageId(quoted?.id)
            const quotedId = extractEscalationId(quoted?.body || '')
            if (!pending && quotedId) {
              pending = getPendingQuestionById(quotedId)
            }
          }
        } catch (quoteErr) {
          logger.warn('[ESCALATION] No se pudo leer mensaje citado para resolver ID', { reason: quoteErr.message || String(quoteErr) }, logCtx)
          logger.categoryMetric('escalation', 'quote_lookup_error', {}, logCtx)
        }
      }

      if (!pending && getPendingCount() === 1) {
        pending = getOldestPendingQuestion()
      }

      if (!pending) {
        const pendingList = listPendingQuestions(5)
          .map(item => `• #${item.escalationId} - ${item.contactName || item.userId.replace('@c.us', '')}`)
          .join('\n')
        const ambiguousMsg =
          '⚠️ Hay varias preguntas pendientes y no pude identificar a cuál responder. ' +
          'Responde citando el mensaje correcto o inicia tu texto con #ID.\n\nPendientes:\n' + pendingList
        addBotMessage(ambiguousMsg)
        await Promise.race([
          message.reply(ambiguousMsg),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:ambiguousEscalationReply')), 8000))
        ])
        logger.categoryMetric('escalation', 'ambiguous_pending', {}, logCtx)
        return
      }

      if (pending) {
        try {
          const ownerHint = messageText.replace(/#([A-Z0-9]{6,})/i, '').trim()
          if (!ownerHint) {
            const emptyHintMsg = `⚠️ Faltó la respuesta para #${pending.escalationId}. Escribe el texto después del ID o responde citando el pendiente.`
            addBotMessage(emptyHintMsg)
            await Promise.race([
              message.reply(emptyHintMsg),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:emptyEscalationHintReply')), 8000))
            ])
            return
          }

          logger.info('[ESCALATION] Cargando contexto del usuario', { targetUserId: pending.userId }, logCtx)
          let context = []
          try {
            context = await Promise.race([
              getContext(pending.userId),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:getContext')), 5000))
            ])
          } catch (ctxErr) {
            logger.warn('[ESCALATION] No se pudo cargar contexto, continuando sin historial', { reason: ctxErr.message }, logCtx)
            context = []
          }

          const hintStartedAt = Date.now()
          logger.info('[ESCALATION] Generando respuesta expandida', { targetUserId: pending.userId }, logCtx)
          const reply = await Promise.race([
            generateReplyFromHint(pending.content, ownerHint, context),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:generateReplyFromHint')), 15000))
          ])
          logger.metric('openai.generateReplyFromHint.latency_ms', Date.now() - hintStartedAt, { targetUserId: pending.userId }, logCtx)
          logger.categoryMetric('openai', 'generate_reply_from_hint', {}, logCtx)

          logger.info('[ESCALATION] Enviando respuesta al usuario original', { targetUserId: pending.userId }, logCtx)
          await Promise.race([
            client.sendMessage(pending.userId, reply),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:sendMessage')), 8000))
          ])
          addBotMessage(reply)

          logger.info('[ESCALATION] Guardando contexto', { targetUserId: pending.userId }, logCtx)
          try {
            await Promise.race([
              saveMessage(pending.userId, 'assistant', reply),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:saveMessage')), 5000))
            ])

            await Promise.race([
              saveLearning(pending.content, reply),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:saveLearning')), 8000))
            ])
          } catch (dbErr) {
              logger.warn('[ESCALATION] No se pudo guardar en BD, pero respuesta ya fue enviada', { reason: dbErr.message }, logCtx)
              logger.categoryMetric('escalation', 'save_partial_error', {}, logCtx)
          }

          removePendingQuestion(pending.escalationId)

          const resolvedLabel = pending.contactName || pending.userId.replace('@c.us', '')
          const confirmMsg = `✅ Respondido a ${resolvedLabel} (ID ${pending.escalationId})`
          addBotMessage(confirmMsg)
          logger.info('[ESCALATION] Enviando confirmacion al grupo', { escalationId: pending.escalationId }, logCtx)
          await Promise.race([
            message.reply(confirmMsg),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:confirmationReply')), 8000))
          ])
          logger.info('[ESCALATION] Flujo completado', { escalationId: pending.escalationId }, logCtx)
          logger.categoryMetric('escalation', 'completed', {}, logCtx)
        } catch (err) {
          logger.error('[ESCALATION] Error en flujo de respuesta', err, logCtx)
          logger.categoryMetric('escalation', 'error', {}, logCtx)
        }
        return
      }
    }

    // no aprender del grupo Whatbot
    if (isCommandGroup) return

    const user = chat.id._serialized
    
    try {
      await Promise.race([
        markHumanActive(user),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:markHumanActive')), 5000))
      ])
    } catch (err) {
      logger.warn('[WARNING] No se pudo marcar humano como activo', { reason: err.message }, { userId: user, conversationId: user })
      logger.categoryMetric('control', 'mark_human_error', {}, { userId: user, conversationId: user })
    }

    try {
      const lastUserMsg = await Promise.race([
        getLastUserMessage(user),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:getLastUserMessage')), 5000))
      ])

      if (lastUserMsg) {
        await Promise.race([
          saveLearning(lastUserMsg, message.body),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:saveLearning')), 8000))
        ])
        logger.info('[EMBEDDING] Aprendizaje guardado', { userId: user }, { userId: user, conversationId: user })
        logger.categoryMetric('embedding', 'learned', {}, { userId: user, conversationId: user })
      }
    } catch (err) {
      logger.warn('[WARNING] No se pudo guardar aprendizaje', { reason: err.message }, { userId: user, conversationId: user })
      logger.categoryMetric('embedding', 'learn_error', {}, { userId: user, conversationId: user })
    }

  } catch (error) {
    if (isTransientContextError(error)) {
      logger.warn('[WARN] Error transitorio al manejar message_create. Se omite este evento.', { reason: error.message || String(error) })
      logger.categoryMetric('message', 'transient_error', {}, { userId: message.from, conversationId: message.from })
      return
    }
    logger.error('[ERROR] Error al manejar el mensaje creado', error)
    logger.categoryMetric('message', 'create_error', {}, { userId: message.from, conversationId: message.from })
  }
})

async function bootstrap() {
  try {
    await db.ensureBaseTables()
    logger.info('[DB] Tablas base verificadas/creadas correctamente')
  } catch (err) {
    logger.error('[DB] Error al verificar/crear tablas base', err)
    process.exit(1)
  }

  client.initialize()
}

bootstrap()