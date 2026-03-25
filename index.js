require('dotenv').config()

const qrcode = require('qrcode-terminal')
const { Client, LocalAuth } = require('whatsapp-web.js')
const { handleMessage } = require('./handlers/messageHandler')
const { saveLearning } = require('./services/learning')
const { getLastUserMessage, getContext, saveMessage } = require('./services/memory')
const { handleCommand } = require('./services/commands')
const { markHumanActive } = require('./services/conversationState')
const { startScheduler } = require('./services/scheduler')
const { isBotMessage, addBotMessage } = require('./services/botMessages')
const { hasPendingQuestions, getOldestPendingQuestion, removePendingQuestion } = require('./services/escalation')
const { generateReplyFromHint } = require('./services/openai')

const os = require('os')

function isTransientContextError(error) {
  if (!error) return false
  const msg = String(error.message || error)
  return msg.includes('Execution context was destroyed') || msg.includes('Cannot find context with specified id')
}

let isReinitializing = false

async function reinitializeClient(client, reason = 'unknown') {
  if (isReinitializing) return
  isReinitializing = true

  try {
    console.warn('[RECOVERY] Reintentando sesion de WhatsApp. Motivo:', reason)
    try {
      await client.destroy()
    } catch (_) {}

    await new Promise(resolve => setTimeout(resolve, 3000))
    await client.initialize()
    console.log('[RECOVERY] Reconexion solicitada correctamente')
  } catch (err) {
    console.error('[RECOVERY] Error al reintentar inicializacion', err)
  } finally {
    isReinitializing = false
  }
}

process.on('unhandledRejection', (reason) => {
  if (isTransientContextError(reason)) {
    console.warn('[WARN] Error transitorio de contexto detectado (unhandledRejection). Se ignora para evitar caida.')
    return
  }

  console.error('[PROCESS] unhandledRejection', reason)
})

process.on('uncaughtException', (error) => {
  if (isTransientContextError(error)) {
    console.warn('[WARN] Error transitorio de contexto detectado (uncaughtException). Se ignora para evitar caida.')
    return
  }

  console.error('[PROCESS] uncaughtException', error)
})

let puppeteerConfig = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
}

// 🧠 Detectar sistema
const platform = process.platform

if (platform === 'linux') {
  console.log('[SYSTEM] Sistema detectado: Linux')

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
  console.log('[SYSTEM] Sistema detectado: Windows')

  puppeteerConfig = {
    headless: true,
    // Windows normalmente ya encuentra Chrome solo
    args: ['--no-sandbox']
  }

} else if (platform === 'darwin') {
  console.log('[SYSTEM] Sistema detectado: macOS')

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
  console.log('[AUTH]')
  qrcode.generate(qr, { small: true })
})

client.on('ready', () => {
  console.log('[BOT] WhatBot listo')
  startScheduler(client)
})

client.on('authenticated', () => {
  console.log('[AUTH] Sesion autenticada')
})

client.on('auth_failure', (msg) => {
  console.error('[AUTH] Fallo de autenticacion', msg)
  reinitializeClient(client, 'auth_failure')
})

client.on('change_state', (state) => {
  console.log('[STATE] Estado del cliente:', state)
})

client.on('disconnected', (reason) => {
  console.error('[STATE] Cliente desconectado:', reason)
  reinitializeClient(client, 'disconnected')
})

client.on('message', async (message) => {
  try {
    if (message.from === 'status@broadcast') return

    console.log('[EVENT] message recibido')
    const chat = await message.getChat()
    const isContact = chat.isGroup ? null : await chat.getContact()
    
    // si no está en mis contactos no contesta
    if(!isContact) {
      console.log('[EVENT] descartado: chat sin contacto directo')
      return
    }
    // ignora mensajes del bot
    if (message.fromMe) {
      console.log('[EVENT] descartado: fromMe')
      return
    }

    // ignorar grupos
    if (message.from.includes('@g.us')) {
      console.log('[EVENT] descartado: grupo')
      return
    }

    //manejamos ahora si el mensaje
    console.log('[EVENT] enviando a handleMessage')
    await handleMessage(client, message)

  } catch (error) {
    if (isTransientContextError(error)) {
      console.warn('[WARN] Error transitorio al manejar message. Se omite este evento.')
      return
    }
    console.error('[ERROR] Error al manejar el mensaje', error)
  }
})

client.on('message_create', async (message) => {
  try {
    if (message.from === 'status@broadcast') return

    if (!message.fromMe) return
    const chat = await message.getChat()

    const isCommandGroup = chat.isGroup && chat.name?.toLowerCase() === 'whatbot'
    const isContact = chat.isGroup ? null : await chat.getContact()
    // Permitir mensajes del grupo Whatbot aunque no sea un contacto individual
    if (!isContact && !isCommandGroup) return

    console.log('[MESSAGE] Nuevo mensaje creado')

    // IGNORAR mensajes del bot
    if (isBotMessage(message.body)) {
      console.log('[MESSAGE] Mensaje del bot ignorado')
      return
    }

    // COMANDOS
    if (isCommandGroup && message.body.startsWith('/')) {
      const handled = await handleCommand(client, message)
      if (handled) return
    }
    //  no aprender comandos
    if (message.body.startsWith('/')) return

    // ESCALATION: si el dueño responde en el grupo Whatbot y hay preguntas pendientes, contestar al usuario
    if (isCommandGroup && hasPendingQuestions()) {
      console.log('[ESCALATION] Respondiendo a pregunta pendiente')
      const pending = getOldestPendingQuestion()
      if (pending) {
        try {
          console.log('[ESCALATION] Cargando contexto del usuario')
          let context = []
          try {
            context = await Promise.race([
              getContext(pending.userId),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:getContext')), 5000))
            ])
          } catch (ctxErr) {
            console.warn('[ESCALATION] No se pudo cargar contexto, continuando sin historial:', ctxErr.message)
            context = []
          }

          console.log('[ESCALATION] Generando respuesta expandida')
          const reply = await Promise.race([
            generateReplyFromHint(pending.content, message.body, context),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:generateReplyFromHint')), 15000))
          ])

          console.log('[ESCALATION] Enviando respuesta al usuario original')
          await Promise.race([
            client.sendMessage(pending.userId, reply),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:sendMessage')), 8000))
          ])
          addBotMessage(reply)

          console.log('[ESCALATION] Guardando contexto')
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
            console.warn('[ESCALATION] No se pudo guardar en BD, pero respuesta ya fue enviada:', dbErr.message)
          }

          removePendingQuestion(pending.userId)

          const confirmMsg = `✅ Respondido a ${pending.userId.replace('@c.us', '')}`
          addBotMessage(confirmMsg)
          console.log('[ESCALATION] Enviando confirmacion al grupo')
          await Promise.race([
            message.reply(confirmMsg),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout:confirmationReply')), 8000))
          ])
          console.log('[ESCALATION] Flujo completado')
        } catch (err) {
          console.error('[ESCALATION] Error en flujo de respuesta', err.message || err)
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
      console.warn('[WARNING] No se pudo marcar humano como activo:', err.message)
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
        console.log('[EMBEDDING] Aprendizaje guardado')
      }
    } catch (err) {
      console.warn('[WARNING] No se pudo guardar aprendizaje:', err.message)
    }

  } catch (error) {
    if (isTransientContextError(error)) {
      console.warn('[WARN] Error transitorio al manejar message_create. Se omite este evento.')
      return
    }
    console.error('[ERROR] Error al manejar el mensaje creado', error)
  }
})

client.initialize()