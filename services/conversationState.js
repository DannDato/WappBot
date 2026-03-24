const db = require('./db')

// ⏱️ 10 minutos de control humano
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

module.exports = {
  markHumanActive,
  isHumanActive,
  releaseHuman
}