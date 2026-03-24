const db = require('./db')
const { getEmbedding } = require('./embeddings')

async function saveLearning(userInput, botResponse) {
  if (userInput.length < 5) return
  if (!userInput || !botResponse) return

  const embedding = await getEmbedding(userInput)

  await db.query(
    `INSERT INTO learned_responses (user_input, bot_response, embedding) VALUES (?, ?, ?)`,
    [userInput, botResponse, JSON.stringify(embedding)]
  )

  console.log('[EMBEDDING] Aprendizaje guardado')
}

module.exports = { saveLearning }