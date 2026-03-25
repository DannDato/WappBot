let botActive = true
const logger = require('./logger')

function isBotActive() {
  return botActive
}

function startBot() {
  botActive = true
  logger.info('[BOT] Bot activado')
  logger.categoryMetric('bot', 'activated')
}

function stopBot() {
  botActive = false
  logger.info('[BOT] Bot desactivado')
  logger.categoryMetric('bot', 'deactivated')
}

module.exports = {
  isBotActive,
  startBot,
  stopBot
}