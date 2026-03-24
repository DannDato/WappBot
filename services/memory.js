const db = require('./db')

const MAX_MESSAGES = 12

async function getContext(user) {
  const [rows] = await db.query(
    `SELECT role, content 
     FROM messages 
     WHERE user_id = ?
     ORDER BY id DESC 
     LIMIT ?`,
    [user, MAX_MESSAGES]
  )
  return rows.reverse()
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