const fs = require('fs')
const path = require('path')
const db = require('./db')
const logger = require('./logger')

const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 30)
const DB_RETENTION_DAYS = Number(process.env.DB_RETENTION_DAYS || 90)
const TOKEN_USAGE_RETENTION_DAYS = Number(process.env.TOKEN_USAGE_RETENTION_DAYS || 120)
const LOG_DIR = path.join(process.cwd(), 'logs')

function buildDateThreshold(days) {
  const safeDays = Number.isFinite(days) && days > 0 ? days : 30
  const threshold = new Date()
  threshold.setDate(threshold.getDate() - safeDays)
  return threshold
}

async function cleanupExpiredOwnerInstructions() {
  const [result] = await db.query(
    `DELETE FROM owner_instructions WHERE expires_at < NOW()`
  )

  return Number(result?.affectedRows || 0)
}

async function cleanupOldMessages() {
  const [result] = await db.query(
    `DELETE FROM messages WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [DB_RETENTION_DAYS]
  )

  return Number(result?.affectedRows || 0)
}

async function cleanupOldLearnedResponses() {
  const [result] = await db.query(
    `DELETE FROM learned_responses WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [DB_RETENTION_DAYS]
  )

  return Number(result?.affectedRows || 0)
}

async function cleanupOldTokenUsage() {
  const [result] = await db.query(
    `DELETE FROM token_usage_daily WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [TOKEN_USAGE_RETENTION_DAYS]
  )

  return Number(result?.affectedRows || 0)
}

function cleanupOldLogFiles() {
  if (!fs.existsSync(LOG_DIR)) return 0

  const threshold = buildDateThreshold(LOG_RETENTION_DAYS)
  const files = fs.readdirSync(LOG_DIR)
  let removed = 0

  for (const fileName of files) {
    const absolutePath = path.join(LOG_DIR, fileName)
    const stat = fs.statSync(absolutePath)
    if (!stat.isFile()) continue

    if (stat.mtime < threshold) {
      fs.unlinkSync(absolutePath)
      removed += 1
    }
  }

  return removed
}

async function runDailyMaintenance() {
  const startedAt = Date.now()
  logger.info('[MAINTENANCE] Inicio de limpieza diaria')

  try {
    const expiredOwnerInstructions = await cleanupExpiredOwnerInstructions()
    const oldMessages = await cleanupOldMessages()
    const oldLearnedResponses = await cleanupOldLearnedResponses()
    const oldTokenUsage = await cleanupOldTokenUsage()
    const oldLogFiles = cleanupOldLogFiles()

    const durationMs = Date.now() - startedAt

    logger.info('[MAINTENANCE] Limpieza diaria completada', {
      expiredOwnerInstructions,
      oldMessages,
      oldLearnedResponses,
      oldTokenUsage,
      oldLogFiles,
      durationMs
    })

    logger.categoryMetric('maintenance', 'run_success')
    logger.metric('maintenance.run.duration_ms', durationMs)
    logger.metric('maintenance.cleanup.owner_instructions.deleted', expiredOwnerInstructions)
    logger.metric('maintenance.cleanup.messages.deleted', oldMessages)
    logger.metric('maintenance.cleanup.learned_responses.deleted', oldLearnedResponses)
    logger.metric('maintenance.cleanup.token_usage.deleted', oldTokenUsage)
    logger.metric('maintenance.cleanup.log_files.deleted', oldLogFiles)
  } catch (error) {
    logger.error('[MAINTENANCE] Error en limpieza diaria', error)
    logger.categoryMetric('maintenance', 'run_error')
  }
}

module.exports = {
  runDailyMaintenance
}
