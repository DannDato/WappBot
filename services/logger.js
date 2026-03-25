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

const BLOCKED_META_KEYS = new Set([
  'userid',
  'conversationid',
  'correlationid',
  'chatid',
  'messageid',
  'targetuserid',
  'contactname',
  'contactlabel',
  'content',
  'message',
  'messages',
  'reply',
  'response',
  'prompt',
  'raw',
  'topic',
  'name',
  'label',
  'phone',
  'email',
  'embedding',
  'stack',
  'errormessage'
])

const ALLOWED_CONTEXT_KEYS = new Set(['scope'])

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

function sanitizePrimitive(value) {
  if (value == null) return value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return '[redacted]'
  return '[redacted]'
}

function sanitizeObject(value) {
  if (!value || typeof value !== 'object') return {}

  const sanitized = {}
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = String(key).toLowerCase()
    if (BLOCKED_META_KEYS.has(normalizedKey)) continue

    if (rawValue == null) continue
    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      sanitized[key] = rawValue
      continue
    }

    if (Array.isArray(rawValue)) {
      sanitized[key] = `[array:${rawValue.length}]`
      continue
    }

    if (typeof rawValue === 'object') {
      sanitized[key] = '[object]'
      continue
    }

    sanitized[key] = sanitizePrimitive(rawValue)
  }

  return sanitized
}

function sanitizeContext(context = {}) {
  const sanitized = {}
  for (const [key, value] of Object.entries(context || {})) {
    if (!ALLOWED_CONTEXT_KEYS.has(String(key).toLowerCase())) continue
    sanitized[key] = value
  }
  return sanitized
}

function emit(level, message, meta = {}, context = {}) {
  const ts = nowIso()
  const safeMeta = sanitizeObject(meta)
  const safeContext = sanitizeContext(context)
  const category = parseCategoryFromMessage(message)

  const payload = {
    ts,
    level,
    category,
    message: safeString(message),
    meta: safeMeta,
    context: safeContext
  }

  appendJsonLine(LOG_FILE, payload)

  const contextText = ''

  const line = `${COLORS.gray}${ts}${COLORS.reset} ${colorizeBracketTag(String(message), level)}${contextText}`
  if (level === 'error') {
    console.error(line, Object.keys(safeMeta).length ? safeMeta : '')
    return
  }
  if (level === 'warn') {
    console.warn(line, Object.keys(safeMeta).length ? safeMeta : '')
    return
  }
  console.log(line, Object.keys(safeMeta).length ? safeMeta : '')
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
        errorType: err.name || 'Error'
      }
    : {}
  emit('error', message, errorMeta, context)
}

function metric(name, value, tags = {}, context = {}) {
  const ts = nowIso()
  const safeTags = sanitizeObject(tags)
  const safeContext = sanitizeContext(context)
  const payload = {
    ts,
    name,
    value,
    tags: safeTags,
    context: safeContext
  }

  appendJsonLine(METRIC_FILE, payload)
  emit('info', `[METRIC] ${name}=${value}`, { tags: safeTags }, safeContext)
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
  return {
    scope: params.scope || 'default'
  }
}

function readMetricLines(limit = 500) {
  ensureLogDir()
  if (!fs.existsSync(METRIC_FILE)) return []

  const content = fs.readFileSync(METRIC_FILE, 'utf8')
  const lines = content.split(/\r?\n/).filter(Boolean)
  return lines.slice(-limit).map(line => {
    try {
      return JSON.parse(line)
    } catch (_) {
      return null
    }
  }).filter(Boolean)
}

function summarizeMetrics(options = {}) {
  const windowMinutes = Number(options.windowMinutes || 60)
  const limit = Number(options.limit || 1000)
  const sinceTs = Date.now() - (windowMinutes * 60 * 1000)
  const rows = readMetricLines(limit).filter(row => {
    const ts = new Date(row.ts).getTime()
    return Number.isFinite(ts) && ts >= sinceTs
  })

  const counterTotals = new Map()
  const latencyBuckets = new Map()

  for (const row of rows) {
    const name = String(row.name || '')
    const value = Number(row.value || 0)

    if (name.endsWith('.count')) {
      counterTotals.set(name, (counterTotals.get(name) || 0) + value)
      continue
    }

    if (name.endsWith('.latency_ms')) {
      const bucket = latencyBuckets.get(name) || { total: 0, count: 0, max: 0 }
      bucket.total += value
      bucket.count += 1
      bucket.max = Math.max(bucket.max, value)
      latencyBuckets.set(name, bucket)
    }
  }

  const topCounters = Array.from(counterTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  const latencies = Array.from(latencyBuckets.entries())
    .map(([name, bucket]) => ({
      name,
      avg: bucket.count > 0 ? Math.round(bucket.total / bucket.count) : 0,
      max: Math.round(bucket.max),
      count: bucket.count
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5)

  return {
    windowMinutes,
    totalMetrics: rows.length,
    counterTotals,
    topCounters,
    latencies
  }
}

function getMetricValue(counterTotals, metricName) {
  return counterTotals.get(metricName) || 0
}

function formatLatencyLabel(name) {
  const labels = {
    'openai.generateReply.latency_ms': 'OpenAI reply',
    'openai.generateReplyFromHint.latency_ms': 'OpenAI hint reply',
    'pipeline.flow.latency_ms': 'Pipeline total'
  }

  return labels[name] || name
}

function formatMetricsSummary(options = {}) {
  const summary = summarizeMetrics(options)

  if (summary.totalMetrics === 0) {
    return `📈 *Metrics*\n\nNo hay métricas registradas en los últimos ${summary.windowMinutes} min`
  }

  const counters = summary.counterTotals

  const groupedSections = [
    {
      title: 'Mensajes',
      lines: [
        `- recibidos: ${getMetricValue(counters, 'category.message.received.count')}`,
        `- creados: ${getMetricValue(counters, 'category.message.created.count')}`,
        `- ignorados bot: ${getMetricValue(counters, 'category.message.ignored_bot.count')}`,
        `- errores create: ${getMetricValue(counters, 'category.message.create_error.count')}`
      ]
    },
    {
      title: 'Pipeline',
      lines: [
        `- completados: ${getMetricValue(counters, 'category.pipeline.completed.count')}`,
        `- respuestas aprendidas: ${getMetricValue(counters, 'category.pipeline.learned_reply.count')}`,
        `- replies vacios: ${getMetricValue(counters, 'category.pipeline.empty_reply.count')}`,
        `- errores: ${getMetricValue(counters, 'category.pipeline.error.count')}`
      ]
    },
    {
      title: 'Escalaciones',
      lines: [
        `- creadas: ${getMetricValue(counters, 'category.escalation.created.count') + getMetricValue(counters, 'category.escalation.pending_added.count')}`,
        `- completadas: ${getMetricValue(counters, 'category.escalation.completed.count')}`,
        `- resueltas: ${getMetricValue(counters, 'category.escalation.resolved.count')}`,
        `- errores: ${getMetricValue(counters, 'category.escalation.error.count') + getMetricValue(counters, 'category.escalation.send_error.count')}`
      ]
    },
    {
      title: 'OpenAI',
      lines: [
        `- replies: ${getMetricValue(counters, 'category.openai.generate_reply.count')}`,
        `- replies por hint: ${getMetricValue(counters, 'category.openai.generate_reply_from_hint.count')}`
      ]
    },
    {
      title: 'Instrucciones',
      lines: [
        `- guardadas: ${getMetricValue(counters, 'category.instruction.saved.count')}`,
        `- auto reply: ${getMetricValue(counters, 'category.instruction.auto_reply.count')}`,
        `- ambiguas: ${getMetricValue(counters, 'category.instruction.ambiguous_contact.count')}`,
        `- errores: ${getMetricValue(counters, 'category.instruction.error.count') + getMetricValue(counters, 'category.instruction.lookup_error.count')}`
      ]
    },
    {
      title: 'Comandos',
      lines: [
        `- recibidos: ${getMetricValue(counters, 'category.command.received.count')}`,
        `- exitosos: ${getMetricValue(counters, 'category.command.success.count')}`,
        `- desconocidos: ${getMetricValue(counters, 'category.command.unknown.count')}`,
        `- errores: ${getMetricValue(counters, 'category.command.error.count')}`
      ]
    },
    {
      title: 'Filtros',
      lines: [
        `- aceptados: ${getMetricValue(counters, 'category.filter.accepted_direct_contact.count') + getMetricValue(counters, 'category.filter.accepted_fallback_contact.count')}`,
        `- ignorados grupo: ${getMetricValue(counters, 'category.filter.ignored_group.count')}`,
        `- ignorados no contacto: ${getMetricValue(counters, 'category.filter.ignored_not_in_contacts.count')}`
      ]
    },
    {
      title: 'Aprendizaje',
      lines: [
        `- embeddings guardados: ${getMetricValue(counters, 'category.embedding.saved.count') + getMetricValue(counters, 'category.embedding.learned.count')}`,
        `- skips input corto: ${getMetricValue(counters, 'category.embedding.skipped_short_input.count')}`,
        `- errores: ${getMetricValue(counters, 'category.embedding.learn_error.count')}`
      ]
    },
    {
      title: 'Reportes',
      lines: [
        `- enviados: ${getMetricValue(counters, 'category.report.sent.count')}`,
        `- triggers: ${getMetricValue(counters, 'category.report.scheduled_trigger.count')}`,
        `- errores: ${getMetricValue(counters, 'category.report.error.count')}`
      ]
    }
  ]

  const sectionText = groupedSections
    .map(section => [`*${section.title}*`, ...section.lines].join('\n'))
    .join('\n\n')

  const counterLines = summary.topCounters.length > 0
    ? summary.topCounters.map(([name, value]) => `- ${name}: ${value}`).join('\n')
    : '- Sin contadores recientes'

  const latencyLines = summary.latencies.length > 0
    ? summary.latencies.map(item => `- ${formatLatencyLabel(item.name)}: avg ${item.avg}ms, max ${item.max}ms, n=${item.count}`).join('\n')
    : '- Sin latencias recientes'

  return [
    `📈 *Metrics (${summary.windowMinutes} min)*`,
    '',
    `Total muestras: ${summary.totalMetrics}`,
    '',
    sectionText,
    '',
    '*Top contadores*',
    counterLines,
    '',
    '*Latencias*',
    latencyLines
  ].join('\n')
}

module.exports = {
  info,
  warn,
  error,
  metric,
  increment,
  categoryMetric,
  createContext,
  summarizeMetrics,
  formatMetricsSummary
}
