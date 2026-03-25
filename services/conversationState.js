const db = require('./db')

const HUMAN_TIMEOUT_MS = 10 * 60 * 1000

async function markHumanActive(user) {
  await db.query(
    `INSERT INTO conversations (user_id, human_active, last_human_message)
     VALUES (?, true, NOW())
     ON DUPLICATE KEY UPDATE
     human_active = true,
     last_human_message = NOW()`,
    [user]
  )
}

async function isHumanActive(user) {
  const [rows] = await db.query(
    `SELECT human_active, last_human_message 
     FROM conversations 
     WHERE user_id = ?`,
    [user]
  )

  if (rows.length === 0) return false

  const { human_active, last_human_message } = rows[0]

  if (!human_active || !last_human_message) return false

  const last = new Date(last_human_message).getTime()
  const now = Date.now()

  // ⏱️ si pasó el timeout → liberar control
  if (now - last > HUMAN_TIMEOUT_MS) {
    await releaseHuman(user)
    return false
  }
  
  return true
}

async function releaseHuman(user) {
  await db.query(
    `UPDATE conversations 
     SET human_active = false 
     WHERE user_id = ?`,
    [user]
  )
}

async function releaseLatestHumanControl() {
  const [rows] = await db.query(
    `SELECT user_id
     FROM conversations
     WHERE human_active = true
     ORDER BY last_human_message DESC
     LIMIT 1`
  )

  if (rows.length === 0) return null

  const userId = rows[0].user_id
  await releaseHuman(userId)
  return userId
}

module.exports = {
  markHumanActive,
  isHumanActive,
  releaseHuman,
  releaseLatestHumanControl
}