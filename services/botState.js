let botActive = true

function isBotActive() {
  return botActive
}

function startBot() {
  botActive = true
  console.log('[BOT] Bot activado')
}

function stopBot() {
  botActive = false
  console.log('[BOT] Bot desactivado')
}

module.exports = {
  isBotActive,
  startBot,
  stopBot
}