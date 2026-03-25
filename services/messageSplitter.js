// Configuración para dividir mensajes largos
const MESSAGE_CONFIG = {
  // Umbral de caracteres: si el mensaje supera esto, se divide
  MAX_CHARS_PER_MESSAGE: 1000,
  // Intervalo (ms) entre envios de mensajes divididos
  INTERVAL_BETWEEN_MESSAGES: 600
}

/**
 * Divide un texto largo en múltiples mensajes respetando párrafos
 * @param {string} text - Texto a dividir
 * @param {number} maxChars - Máximo de caracteres por mensaje (default: 1000)
 * @returns {string[]} Array de mensajes
 */
function splitMessage(text, maxChars = MESSAGE_CONFIG.MAX_CHARS_PER_MESSAGE) {
  if (text.length <= maxChars) {
    return [text]
  }

  const messages = []
  const paragraphs = text.split('\n')
  let currentMessage = ''

  for (const paragraph of paragraphs) {
    // Si añadir este párrafo excede el límite
    if ((currentMessage + '\n' + paragraph).length > maxChars && currentMessage) {
      messages.push(currentMessage.trim())
      currentMessage = paragraph
    } else {
      if (currentMessage) {
        currentMessage += '\n' + paragraph
      } else {
        currentMessage = paragraph
      }
    }
  }

  // Agregar el último mensaje
  if (currentMessage) {
    messages.push(currentMessage.trim())
  }

  // Si aún hay párrafos muy largos, dividirlos por caracteres
  return messages.flatMap(msg => {
    if (msg.length <= maxChars) {
      return [msg]
    }
    // Dividir por líneas dentro del párrafo
    const lines = msg.split('\n')
    const chunked = []
    let chunk = ''
    
    for (const line of lines) {
      if ((chunk + '\n' + line).length > maxChars && chunk) {
        chunked.push(chunk.trim())
        chunk = line
      } else {
        chunk = chunk ? chunk + '\n' + line : line
      }
    }
    if (chunk) chunked.push(chunk.trim())
    
    return chunked
  })
}

/**
 * Envía un mensaje dividido en múltiples partes con intervalo
 * @param {WhatsApp.Message} message - Mensaje original (para reply)
 * @param {string} chatId - ID del chat (para sendMessage)
 * @param {string} text - Texto a enviar
 * @param {Object} options - {useReply: boolean, client: WhatsAppClient}
 */
async function sendSplitMessage(message, chatId, text, options = {}) {
  const { useReply = false, client } = options

  const messages = splitMessage(text, MESSAGE_CONFIG.MAX_CHARS_PER_MESSAGE)
  const count = messages.length

  console.log(`[MESSAGE] Enviando ${count} mensaje(s) con umbral ${MESSAGE_CONFIG.MAX_CHARS_PER_MESSAGE} chars`)

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    
    try {
      if (useReply && i === 0) {
        // Solo usar reply en el primer mensaje
        await message.reply(msg)
        console.log(`[MESSAGE] Mensaje 1/${count} enviado como reply (${msg.length} chars)`)
      } else {
        // Usar sendMessage para los demás
        await client.sendMessage(chatId, msg)
        console.log(`[MESSAGE] Mensaje ${i + 1}/${count} enviado (${msg.length} chars)`)
      }

      // Si hay más mensajes, esperar el intervalo antes de enviar el siguiente
      if (i < messages.length - 1) {
        await new Promise(resolve => 
          setTimeout(resolve, MESSAGE_CONFIG.INTERVAL_BETWEEN_MESSAGES)
        )
      }
    } catch (err) {
      console.error(`[MESSAGE] Error al enviar mensaje ${i + 1}/${count}:`, err.message)
      throw err
    }
  }
}

module.exports = {
  splitMessage,
  sendSplitMessage,
  MESSAGE_CONFIG
}
