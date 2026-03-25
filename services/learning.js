const db = require('./db')
const { getEmbedding } = require('./embeddings')
const logger = require('./logger')

async function saveLearning(userInput, botResponse) {
  if (!userInput || !botResponse) {
    logger.categoryMetric('embedding', 'skipped_empty')
    return
  }

  if (userInput.length < 5) {
    logger.categoryMetric('embedding', 'skipped_short_input', { inputLength: userInput.length })
    return
  }

  const embedding = await getEmbedding(userInput)

  await db.query(
    `INSERT INTO learned_responses (user_input, bot_response, embedding) VALUES (?, ?, ?)`,
    [userInput, botResponse, JSON.stringify(embedding)]
  )

  logger.info('[EMBEDDING] Aprendizaje guardado', { inputLength: userInput.length })
  logger.categoryMetric('embedding', 'saved', { inputLength: userInput.length })
}

module.exports = { saveLearning }