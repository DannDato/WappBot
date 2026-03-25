const fs = require('fs')
const path = require('path')

const LOG_DIR = path.join(process.cwd(), 'logs')
const LOG_FILE = path.join(LOG_DIR, 'audit.log')
const METRIC_FILE = path.join(LOG_DIR, 'metrics.log')

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m'
}

const LEVEL_TO_COLOR = {
  info: COLORS.green,
  warn: COLORS.yellow,
  error: COLORS.red
}

const CATEGORY_COLORS = {
  AUTH: COLORS.cyan,
  BOT: COLORS.green,
  PIPELINE: COLORS.magenta,
  CONTROL: COLORS.cyan,
  ESCALATION: COLORS.yellow,
  EVENT: COLORS.gray,
  DB: COLORS.cyan,
  OPENAI: COLORS.magenta,
  METRIC: COLORS.green,
  DEFAULT: COLORS.gray
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

function nowIso() {
  return new Date().toISOString()
}

function safeString(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch (_) {
    return String(value)
  }
}

function parseCategoryFromMessage(message = '') {
  const match = String(message).match(/^\[([^\]]+)\]/)
  if (!match) return 'DEFAULT'
  return String(match[1] || 'DEFAULT').toUpperCase()
}

function colorizeBracketTag(message = '', level = 'info') {
  const category = parseCategoryFromMessage(message)
  const levelColor = LEVEL_TO_COLOR[level] || COLORS.gray
  const categoryColor = CATEGORY_COLORS[category] || CATEGORY_COLORS.DEFAULT

  return String(message).replace(/^\[([^\]]+)\]/, (_, tag) => {
    return `${levelColor}[${categoryColor}${tag}${levelColor}]${COLORS.reset}`
  })
}

function appendJsonLine(filePath, payload) {
  ensureLogDir()
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8')
}

function emit(level, message, meta = {}, context = {}) {
  const ts = nowIso()
  const correlationId = context.correlationId || context.userId || null
  const userId = context.userId || null
  const category = parseCategoryFromMessage(message)

  const payload = {
    ts,
    level,
    category,
    message: safeString(message),
    correlationId,
    userId,
    meta
  }

  appendJsonLine(LOG_FILE, payload)

  const contextBits = []
  if (correlationId) contextBits.push(`cid=${correlationId}`)
  if (userId) contextBits.push(`user=${userId}`)
  const contextText = contextBits.length ? ` (${contextBits.join(' ')})` : ''

  const line = `${ts} ${colorizeBracketTag(String(message), level)}${contextText}`
  if (level === 'error') {
    console.error(line, Object.keys(meta || {}).length ? meta : '')
    return
  }
  if (level === 'warn') {
    console.warn(line, Object.keys(meta || {}).length ? meta : '')
    return
  }
  console.log(line, Object.keys(meta || {}).length ? meta : '')
}

function info(message, meta = {}, context = {}) {
  emit('info', message, meta, context)
}

function warn(message, meta = {}, context = {}) {
  emit('warn', message, meta, context)
}

function error(message, err = null, context = {}) {
  const errorMeta = err
    ? {
        errorMessage: err.message || String(err),
        stack: err.stack || null
      }
    : {}
  emit('error', message, errorMeta, context)
}

function metric(name, value, tags = {}, context = {}) {
  const ts = nowIso()
  const payload = {
    ts,
    name,
    value,
    tags,
    correlationId: context.correlationId || context.userId || null,
    userId: context.userId || null
  }

  appendJsonLine(METRIC_FILE, payload)
  emit('info', `[METRIC] ${name}=${value}`, { tags }, context)
}

function increment(name, tags = {}, context = {}, value = 1) {
  metric(name, value, tags, context)
}

function categoryMetric(category, action, tags = {}, context = {}, value = 1) {
  const safeCategory = String(category || 'default').toLowerCase()
  const safeAction = String(action || 'event').toLowerCase()
  increment(`category.${safeCategory}.${safeAction}.count`, tags, context, value)
}

function createContext(params = {}) {
  const userId = params.userId || null
  const conversationId = params.conversationId || userId || null
  const reqId = Date.now().toString(36).toUpperCase()
  const correlationId = conversationId ? `${conversationId}:${reqId}` : reqId

  return {
    userId,
    conversationId,
    correlationId
  }
}

module.exports = {
  info,
  warn,
  error,
  metric,
  increment,
  categoryMetric,
  createContext
}
