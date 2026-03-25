const db = require('./db')

const MAX_MESSAGES = 20

function normalizeRole(role = '') {
  const value = String(role).toLowerCase()
  if (value === 'assistant' || value === 'bot') return 'assistant'
  return 'user'
}

function sanitizeContent(content = '') {
  return String(content).replace(/\s+/g, ' ').trim()
}

async function getContext(user) {
  const [rows] = await db.query(
    `SELECT role, content, created_at
     FROM messages
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [user, MAX_MESSAGES]
  )

  return rows
    .reverse()
    .map(row => ({
      role: normalizeRole(row.role),
      content: sanitizeContent(row.content),
      created_at: row.created_at
    }))
    .filter(row => row.content.length > 0)
}

async function saveMessage(user, role, content) {
  await db.query(
    `INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)`,
    [user, role, content]
  )
}

async function getLastUserMessage(user) {
  const [rows] = await db.query(
    `SELECT content
     FROM messages
     WHERE user_id = ? AND role = 'user'
     ORDER BY id DESC
     LIMIT 1`,
    [user]
  )

  return rows[0]?.content || null
}

module.exports = {
  getContext,
  saveMessage,
  getLastUserMessage
}