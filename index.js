require('dotenv').config()

const qrcode = require('qrcode-terminal')
const { Client, LocalAuth } = require('whatsapp-web.js')
const { handleMessage } = require('./handlers/messageHandler')
const { saveLearning } = require('./services/learning')
const { getLastUserMessage } = require('./services/memory')
const { handleCommand } = require('./services/commands')
const { markHumanActive } = require('./services/conversationState')
const { startScheduler } = require('./services/scheduler')
const { isBotMessage } = require('./services/botMessages')


const os = require('os')
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

client.on('message', async (message) => {
  try {
    const chat = await message.getChat()
    const isContact = chat.isGroup ? null : await chat.getContact()
    if(!isContact) return
    // 🚫 ignorar mensajes tuyos
    if (message.fromMe) return

    // 🚫 ignorar grupos (opcional, pero recomendado)
    if (message.from.includes('@g.us')) return

    console.log('[MESSAGE] Nuevo mensaje recibido')

    await handleMessage(client, message)

  } catch (error) {
    console.error('[ERROR] Error al manejar el mensaje', error)
  }
})

client.on('message_create', async (message) => {
  try {
    if (!message.fromMe) return

    const chat = await message.getChat()
    const isContact = chat.isGroup ? null : await chat.getContact()
    if(!isContact) return

    const isCommandGroup = chat.isGroup && chat.name?.toLowerCase() === 'whatbot'

    console.log('[MESSAGE] Nuevo mensaje creado')

    // 🤖 IGNORAR mensajes del bot
    if (isBotMessage(message.body)) {
      console.log('[MESSAGE] Mensaje del bot ignorado')
      return
    }

    // 🧠 COMANDOS
    if (isCommandGroup && message.body.startsWith('/')) {
      const handled = await handleCommand(message)
      if (handled) return
    }

    // 🚫 no aprender comandos
    if (message.body.startsWith('/')) return

    // 🚫 no aprender del grupo Whatbot
    if (isCommandGroup) return

    const user = chat.id._serialized

    await markHumanActive(user)

    const lastUserMsg = await getLastUserMessage(user)

    if (lastUserMsg) {
      await saveLearning(lastUserMsg, message.body)
      console.log('[EMBEDDING] Aprendizaje guardado')
    }

  } catch (error) {
    console.error('[ERROR] Error al manejar el mensaje creado', error)
  }
})

client.initialize()