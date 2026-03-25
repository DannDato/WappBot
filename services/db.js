const mysql = require('mysql2/promise')

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'whatbot',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
})

async function ensureBaseTables() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(50) NOT NULL,
      role ENUM('user', 'assistant') NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_messages_user_id (user_id),
      INDEX idx_messages_created_at (created_at)
    )`
  )

  await pool.query(
    `CREATE TABLE IF NOT EXISTS conversations (
      user_id VARCHAR(50) PRIMARY KEY,
      human_active BOOLEAN DEFAULT FALSE,
      last_human_message TIMESTAMP NULL
    )`
  )

  await pool.query(
    `CREATE TABLE IF NOT EXISTS learned_responses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_input TEXT NOT NULL,
      bot_response TEXT NOT NULL,
      embedding JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_learned_created_at (created_at)
    )`
  )

  await pool.query(
    `CREATE TABLE IF NOT EXISTS owner_instructions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(50) NOT NULL,
      contact_label VARCHAR(120) NULL,
      topic VARCHAR(255) NOT NULL,
      response TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_owner_user_topic (user_id, topic),
      INDEX idx_owner_expires (expires_at)
    )`
  )
}

module.exports = {
  query: pool.query.bind(pool),
  execute: pool.execute.bind(pool),
  getConnection: pool.getConnection.bind(pool),
  ensureBaseTables
}