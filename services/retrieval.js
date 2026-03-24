const db = require('./db')
const { getEmbedding } = require('./embeddings')
const { cosineSimilarity } = require('../utils/similarity')

const SIMILARITY_THRESHOLD = 0.75

async function findLearnedResponse(message) {
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
    console.log('[EVAL] Mejor respuesta aprendida ')
    return bestMatch.bot_response
  }

  return null
}

module.exports = { findLearnedResponse }