const db = require('./db')

const REPORT_TIMEZONE = 'America/Mexico_City'

function toMexicoDayKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  return formatter.format(new Date(date))
}

async function recordTokenUsage({ source = 'unknown', model = 'unknown', usage = {} } = {}) {
  const totalTokens = Number(usage.total_tokens || 0)
  const promptTokens = Number(usage.prompt_tokens || 0)
  const completionTokens = Number(usage.completion_tokens || 0)

  if (!totalTokens && !promptTokens && !completionTokens) return

  await db.query(
    `INSERT INTO token_usage_daily (usage_date, source, model, total_tokens, prompt_tokens, completion_tokens)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      toMexicoDayKey(new Date()),
      source,
      model,
      totalTokens,
      promptTokens,
      completionTokens
    ]
  )
}

async function getDailyTokenUsage(referenceDate = new Date()) {
  const usageDate = toMexicoDayKey(referenceDate)
  const [rows] = await db.query(
    `SELECT
       COALESCE(SUM(total_tokens), 0) AS totalTokens,
       COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
       COALESCE(SUM(completion_tokens), 0) AS completionTokens
     FROM token_usage_daily
     WHERE usage_date = ?`,
    [usageDate]
  )

  return {
    usageDate,
    totalTokens: Number(rows[0]?.totalTokens || 0),
    promptTokens: Number(rows[0]?.promptTokens || 0),
    completionTokens: Number(rows[0]?.completionTokens || 0)
  }
}

async function getTokenUsageWindowSummary(windowMinutes = 60) {
  const safeWindowMinutes = Number.isFinite(Number(windowMinutes)) && Number(windowMinutes) > 0
    ? Number(windowMinutes)
    : 60

  const [rows] = await db.query(
    `SELECT
       COALESCE(SUM(total_tokens), 0) AS totalTokens,
       COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
       COALESCE(SUM(completion_tokens), 0) AS completionTokens
     FROM token_usage_daily
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [safeWindowMinutes]
  )

  return {
    windowMinutes: safeWindowMinutes,
    totalTokens: Number(rows[0]?.totalTokens || 0),
    promptTokens: Number(rows[0]?.promptTokens || 0),
    completionTokens: Number(rows[0]?.completionTokens || 0)
  }
}

module.exports = {
  recordTokenUsage,
  getDailyTokenUsage,
  getTokenUsageWindowSummary,
  toMexicoDayKey
}
