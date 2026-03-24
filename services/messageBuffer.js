const buffers = new Map()

const DELAY_MS = 8000 // 8 segundos (ajústalo)

function addMessage(user, message, callback) {
  if (!buffers.has(user)) {
    buffers.set(user, {
      messages: [],
      timer: null
    })
  }

  const buffer = buffers.get(user)

  buffer.messages.push(message)

  // resetear timer
  if (buffer.timer) {
    clearTimeout(buffer.timer)
  }

  buffer.timer = setTimeout(() => {
    const combined = buffer.messages.join(' ')
    
    buffers.delete(user)

    callback(combined)
  }, DELAY_MS)
}

module.exports = { addMessage }