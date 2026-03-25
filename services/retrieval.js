const db = require('./db')
const { getEmbedding } = require('./embeddings')
const { cosineSimilarity } = require('../utils/similarity')
const logger = require('./logger')

const SIMILARITY_THRESHOLD = 0.75

async function findLearnedResponse(message) {
  logger.categoryMetric('retrieval', 'lookup_started')
  const embedding = await getEmbedding(message)

  const [rows] = await db.query(
    `SELECT user_input, bot_response, embedding 
     FROM learned_responses`
  )

  let bestMatch = null
  let bestScore = 0

  for (const row of rows) {
    if (!row.embedding) continue

    const storedEmbedding = JSON.parse(row.embedding)

    const score = cosineSimilarity(embedding, storedEmbedding)

    if (score > bestScore) {
      bestScore = score
      bestMatch = row
    }
  }

  if (bestScore >= SIMILARITY_THRESHOLD) {
    logger.info('[EVAL] Mejor respuesta aprendida', { score: bestScore })
    logger.categoryMetric('retrieval', 'hit', { score: Number(bestScore.toFixed(3)) })
    return bestMatch.bot_response
  }

  logger.categoryMetric('retrieval', 'miss', { score: Number(bestScore.toFixed(3)) })

  return null
}

module.exports = { findLearnedResponse }