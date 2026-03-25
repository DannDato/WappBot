const buffers = new Map()

const DELAY_MS = 10000 // 10 segundos

function addMessage(user, message, callback) {
  if (!buffers.has(user)) {
    buffers.set(user, {
      messages: [],
      timer: null
    })
  }

  // crear buffer de ese usuario si no existe
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