const botMessages = new Set()

function addBotMessage(content) {
  botMessages.add(content)
  // limpiar después de 10 segundos
  setTimeout(() => {
    botMessages.delete(content)
  }, 10000)
}

function isBotMessage(content) {
  return botMessages.has(content)
}

module.exports = {
  addBotMessage,
  isBotMessage
}