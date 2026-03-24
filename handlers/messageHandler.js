const { shouldIgnoreMessage } = require('../utils/filters')
const { generateReply } = require('../services/openai')
const { getContext, saveMessage } = require('../services/memory')
const { decideReply } = require('../services/decision')
const { findLearnedResponse } = require('../services/retrieval')
const { isHumanActive } = require('../services/conversationState')
const { isBotActive } = require('../services/botState')
const { addBotMessage } = require('../services/botMessages')
const { addMessage } = require('../services/messageBuffer')

async function handleMessage(client, message) {
    if (await shouldIgnoreMessage(message)) return

    const user = message.from
    const content = message.body.trim()

    console.log(`[MESSAGE] ${user}: ${content}`)

    // 🧠 BUFFER
    addMessage(user, content, async (combinedMessage) => {
        console.log(`[BUFFER] ${user}: ${combinedMessage}`)

        const context = await getContext(user)

        // 🧠 learned primero
        const learned = await findLearnedResponse(combinedMessage)

        if (learned) {
            await message.reply(learned)

            await saveMessage(user, 'user', combinedMessage)
            await saveMessage(user, 'assistant', learned)

            return
        }

        const decision = await decideReply(combinedMessage, context)

        if (!decision.shouldReply || decision.confidence < 0.7) {
            return
        }

        const reply = await generateReply(combinedMessage, context)

        if (!reply) return

        await message.reply(reply)

        await saveMessage(user, 'user', combinedMessage)
        await saveMessage(user, 'assistant', reply)
    })
}

module.exports = { handleMessage }