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

function normalizeUsageDateInput(input) {
  if (!input) return null

  const text = String(input).trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const utcDate = new Date(Date.UTC(year, month - 1, day))
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null
  }

  return text
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

async function getDailyTokenUsageByDate(usageDateInput) {
  const usageDate = normalizeUsageDateInput(usageDateInput)
  if (!usageDate) {
    throw new Error('invalid_usage_date')
  }

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

async function getDailyTokenUsageBreakdown(usageDateInput) {
  const usageDate = normalizeUsageDateInput(usageDateInput)
  if (!usageDate) {
    throw new Error('invalid_usage_date')
  }

  const [rows] = await db.query(
    `SELECT
       source,
       model,
       COALESCE(SUM(total_tokens), 0) AS totalTokens,
       COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
       COALESCE(SUM(completion_tokens), 0) AS completionTokens,
       COUNT(*) AS requestCount
     FROM token_usage_daily
     WHERE usage_date = ?
     GROUP BY source, model
     ORDER BY totalTokens DESC, requestCount DESC, source ASC, model ASC`,
    [usageDate]
  )

  return rows.map(row => ({
    source: row.source,
    model: row.model,
    totalTokens: Number(row.totalTokens || 0),
    promptTokens: Number(row.promptTokens || 0),
    completionTokens: Number(row.completionTokens || 0),
    requestCount: Number(row.requestCount || 0)
  }))
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
  getDailyTokenUsageByDate,
  getDailyTokenUsageBreakdown,
  getTokenUsageWindowSummary,
  toMexicoDayKey,
  normalizeUsageDateInput
}
