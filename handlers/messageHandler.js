const { shouldIgnoreMessage } = require('../utils/filters')
const { generateReply } = require('../services/openai')
const { getContext, saveMessage } = require('../services/memory')
const { decideReply } = require('../services/decision')
const { findLearnedResponse } = require('../services/retrieval')
const { isHumanActive } = require('../services/conversationState')
const { isBotActive } = require('../services/botState')
const { addBotMessage } = require('../services/botMessages')
const { addMessage } = require('../services/messageBuffer')
const { addPendingQuestion, attachEscalationMessageId } = require('../services/escalation')
const { sendSplitMessage } = require('../services/messageSplitter')
const { findInstructionForMessage } = require('../services/ownerInstructions')

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms))
    ])
}

async function handleMessage(client, message) {
    if (await shouldIgnoreMessage(message, client)) return

    console.log('[MESSAGE] Nuevo mensaje recibido')
    const user = message.from
    const content = message.body.trim()

    // BUFFER
    addMessage(user, content, async (combinedMessage) => {
        try {
            console.log('[BUFFER] Mensaje consolidado listo')

            if (!isBotActive()) {
                console.log('[CONTROL] Bot en modo silencioso, no se respondera')
                return
            }

            try {
                const humanActive = await withTimeout(isHumanActive(user), 5000, 'isHumanActive')
                if (humanActive) {
                    console.log('[CONTROL] Humano tiene el control, el bot no respondera')
                    return
                }
            } catch (err) {
                console.warn('[CONTROL] No se pudo verificar control humano, continuando con automatizacion')
            }

            console.log('[PIPELINE] Cargando contexto')
            let context = []
            try {
                context = await withTimeout(getContext(user), 5000, 'getContext')
            } catch (err) {
                console.warn('[PIPELINE] Contexto no disponible, continuando sin historial')
                context = []
            }

            // Extraer tag de persona del nombre del contacto (ej: "Juan :Rapper" -> "rapper")
            let persona = null
            let contactNameForAI = ''
            try {
                const contact = await withTimeout(message.getContact(), 3000, 'getContact')
                const contactName = contact.pushname || contact.name || ''
                contactNameForAI = contact.name || contact.pushname || user.replace('@c.us', '')
                const match = contactName.match(/:([\w]+)/i)
                if (match) persona = match[1].toLowerCase()
            } catch (_) {}

            console.log('[PIPELINE] Buscando respuesta aprendida')
            let learned = null
            try {
                learned = await withTimeout(findLearnedResponse(combinedMessage), 12000, 'findLearnedResponse')
            } catch (err) {
                console.warn('[PIPELINE] Retrieval no disponible, continuando con decision')
            }

            if (learned) {
                console.log('[PIPELINE] Respuesta aprendida encontrada, enviando')
                await withTimeout(
                    sendSplitMessage(message, user, learned, { useReply: true, client }),
                    30000,
                    'sendLearnedReply'
                )
                await saveMessage(user, 'user', combinedMessage)
                await saveMessage(user, 'assistant', learned)
                return
            }

            console.log('[PIPELINE] Ejecutando decideReply')
            let decision = null
            try {
                decision = await withTimeout(decideReply(combinedMessage, context), 12000, 'decideReply')
            } catch (err) {
                console.warn('[PIPELINE] Decision no disponible, se escalara a humano')
                decision = { shouldReply: false, confidence: 0, askHuman: true, isContinuation: false, reason: 'decision_timeout_or_error' }
            }

            // Si es continuación de un hilo activo, relajar el umbral de confianza
            const confidenceThreshold = decision.isContinuation ? 0.5 : 0.7

            if (!decision.shouldReply || decision.confidence < confidenceThreshold) {
                // Buscar instruccion temporal del dueño antes de escalar a humano
                try {
                    const ownerInstruction = await withTimeout(
                        findInstructionForMessage(user, combinedMessage),
                        5000,
                        'findInstructionForMessage'
                    )

                    if (ownerInstruction?.response) {
                        console.log('[PIPELINE] Respuesta por instruccion temporal encontrada, enviando')
                        await withTimeout(
                            sendSplitMessage(message, user, ownerInstruction.response, { useReply: true, client }),
                            30000,
                            'sendOwnerInstructionReply'
                        )
                        await saveMessage(user, 'user', combinedMessage)
                        await saveMessage(user, 'assistant', ownerInstruction.response)
                        return
                    }
                } catch (instructionErr) {
                    console.warn('[PIPELINE] No se pudo evaluar instruccion temporal, continuando con escalacion')
                }

                // Si el bot no sabe responder, escalar al dueño en el grupo Whatbot
                if (decision.askHuman) {
                    try {
                        const chats = await withTimeout(client.getChats(), 6000, 'getChats')
                        const whatbotGroup = chats.find(c => c.isGroup && c.name?.toLowerCase() === 'whatbot')
                        if (whatbotGroup) {
                            const contact = await withTimeout(message.getContact(), 3000, 'getContactForEscalation')
                            const name = contact.pushname || contact.name || user.replace('@c.us', '')
                            const escalationId = addPendingQuestion(user, combinedMessage, { contactName: name })
                            const escalationMsg = `❓ *Pregunta pendiente* [ID:${escalationId}]\n_De: ${name}_\n\n"${combinedMessage}"\n\n_Responde citando este mensaje o inicia tu texto con #${escalationId} para contestarle al chat correcto._`
                            addBotMessage(escalationMsg)
                            const sentEscalationMessage = await withTimeout(whatbotGroup.sendMessage(escalationMsg), 8000, 'sendEscalation')
                            const linked = attachEscalationMessageId(escalationId, sentEscalationMessage?.id)
                            if (!linked) {
                                console.warn(`[ESCALATION] No se pudo vincular mensaje de grupo al pendiente ${escalationId}`)
                            }
                            console.log('[ESCALATION] Pregunta enviada al grupo Whatbot')
                        } else {
                            console.warn('[ESCALATION] Grupo Whatbot no encontrado')
                        }
                    } catch (err) {
                        console.error('[ESCALATION] Error al enviar al grupo Whatbot', err)
                    }
                }
                return
            }

            console.log('[PIPELINE] Generando respuesta')
            const reply = await withTimeout(generateReply(combinedMessage, context, persona, contactNameForAI), 15000, 'generateReply')

            if (!reply) {
                console.warn('[PIPELINE] No se genero respuesta')
                return
            }

            // esto es para contestar en modo "responder" al mensaje solo un 40% de las veces, para que no siempre se vea como un bot
            const useReply = Math.random() < 0.4
            await withTimeout(
                sendSplitMessage(message, user, reply, { useReply, client }),
                30000,
                'sendSplitMessage'
            )

            await saveMessage(user, 'user', combinedMessage)
            await saveMessage(user, 'assistant', reply)
            console.log('[PIPELINE] Flujo completado')
        } catch (err) {
            console.error('[PIPELINE] Error no controlado en callback del buffer', err)
        }
    })
}

module.exports = { handleMessage }