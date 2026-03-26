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
const logger = require('../services/logger')

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms))
    ])
}

async function handleMessage(client, message) {
    if (await shouldIgnoreMessage(message, client)) return

    const user = message.from
    const logCtx = logger.createContext({ userId: user, conversationId: user })
    logger.infoIncomingMessage('[MESSAGE] Nuevo mensaje recibido', { messageId: message.id?._serialized || null }, logCtx)
    logger.categoryMetric('message', 'received', {}, logCtx)
    const content = message.body.trim()
    const flowStartedAt = Date.now()

    // BUFFER
    addMessage(user, content, async (combinedMessage) => {
        try {
            logger.info('[BUFFER] Mensaje consolidado listo', { combinedLength: combinedMessage.length }, logCtx)
            logger.categoryMetric('buffer', 'ready', {}, logCtx)

            if (!isBotActive()) {
                logger.info('[CONTROL] Bot en modo silencioso, no se respondera', {}, logCtx)
                logger.categoryMetric('control', 'bot_silent', {}, logCtx)
                return
            }

            try {
                const humanActive = await withTimeout(isHumanActive(user), 5000, 'isHumanActive')
                if (humanActive) {
                    logger.info('[CONTROL] Humano tiene el control, el bot no respondera', {}, logCtx)
                    logger.categoryMetric('control', 'human_active', {}, logCtx)
                    return
                }
            } catch (err) {
                logger.warn('[CONTROL] No se pudo verificar control humano, continuando con automatizacion', { reason: err.message }, logCtx)
                logger.categoryMetric('control', 'human_check_error', {}, logCtx)
            }

            logger.info('[PIPELINE] Cargando contexto', {}, logCtx)
            let context = []
            try {
                context = await withTimeout(getContext(user), 5000, 'getContext')
            } catch (err) {
                logger.warn('[PIPELINE] Contexto no disponible, continuando sin historial', { reason: err.message }, logCtx)
                logger.categoryMetric('pipeline', 'context_unavailable', {}, logCtx)
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

            logger.info('[PIPELINE] Buscando respuesta aprendida', {}, logCtx)
            let learned = null
            try {
                learned = await withTimeout(findLearnedResponse(combinedMessage), 12000, 'findLearnedResponse')
            } catch (err) {
                logger.warn('[PIPELINE] Retrieval no disponible, continuando con decision', { reason: err.message }, logCtx)
                logger.categoryMetric('pipeline', 'retrieval_error', {}, logCtx)
            }

            if (learned) {
                logger.info('[PIPELINE] Respuesta aprendida encontrada, enviando', {}, logCtx)
                logger.categoryMetric('pipeline', 'learned_reply', {}, logCtx)
                await withTimeout(
                    sendSplitMessage(message, user, learned, { useReply: true, client }),
                    30000,
                    'sendLearnedReply'
                )
                await saveMessage(user, 'user', combinedMessage)
                await saveMessage(user, 'assistant', learned)
                return
            }

            logger.info('[PIPELINE] Ejecutando decideReply', { contextCount: context.length }, logCtx)
            let decision = null
            try {
                decision = await withTimeout(decideReply(combinedMessage, context), 12000, 'decideReply')
            } catch (err) {
                logger.warn('[PIPELINE] Decision no disponible, se escalara a humano', { reason: err.message }, logCtx)
                logger.categoryMetric('decision', 'error', {}, logCtx)
                decision = { shouldReply: false, confidence: 0, askHuman: true, isContinuation: false, reason: 'decision_timeout_or_error' }
            }

            logger.categoryMetric('decision', decision.shouldReply ? 'reply_yes' : 'reply_no', { askHuman: Boolean(decision.askHuman), continuation: Boolean(decision.isContinuation) }, logCtx)

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
                        logger.info('[PIPELINE] Respuesta por instruccion temporal encontrada, enviando', { topic: ownerInstruction.topic }, logCtx)
                        logger.categoryMetric('instruction', 'auto_reply', { topic: ownerInstruction.topic }, logCtx)
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
                    logger.warn('[PIPELINE] No se pudo evaluar instruccion temporal, continuando con escalacion', { reason: instructionErr.message }, logCtx)
                    logger.categoryMetric('instruction', 'lookup_error', {}, logCtx)
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
                            const escalationMsg = `❓ *Pregunta*\n_De: ${name}_\n\n"${combinedMessage}"\n\n`
                            addBotMessage(escalationMsg)
                            const sentEscalationMessage = await withTimeout(whatbotGroup.sendMessage(escalationMsg), 8000, 'sendEscalation')
                            const linked = attachEscalationMessageId(escalationId, sentEscalationMessage?.id)
                            if (!linked) {
                                logger.warn(`[ESCALATION] No se pudo vincular mensaje de grupo al pendiente ${escalationId}`, {}, logCtx)
                                logger.categoryMetric('escalation', 'link_error', {}, logCtx)
                            }
                            logger.info('[ESCALATION] Pregunta enviada al grupo Whatbot', { escalationId }, logCtx)
                            logger.categoryMetric('escalation', 'created', {}, logCtx)
                        } else {
                            logger.warn('[ESCALATION] Grupo Whatbot no encontrado', {}, logCtx)
                            logger.categoryMetric('escalation', 'group_missing', {}, logCtx)
                        }
                    } catch (err) {
                        logger.error('[ESCALATION] Error al enviar al grupo Whatbot', err, logCtx)
                        logger.categoryMetric('escalation', 'send_error', {}, logCtx)
                    }
                } else {
                    // Si la decision es esperar (sin escalar), avisar al grupo Whatbot
                    try {
                        const chats = await withTimeout(client.getChats(), 6000, 'getChatsForWaitNotify')
                        const whatbotGroup = chats.find(c => c.isGroup && c.name?.toLowerCase() === 'whatbot')
                        if (whatbotGroup) {
                            const contact = await withTimeout(message.getContact(), 3000, 'getContactForWaitNotify')
                            const name = contact.pushname || contact.name || user.replace('@c.us', '')
                            const waitMsg = `🕑 Esperando respuesta en la conversacion con ${name}`
                            addBotMessage(waitMsg)
                            await withTimeout(
                                whatbotGroup.sendMessage(waitMsg),
                                8000,
                                'sendWaitNotification'
                            )
                            logger.info('[DECISION] Notificacion de espera enviada al grupo Whatbot', {}, logCtx)
                            logger.categoryMetric('decision', 'wait_notified', {}, logCtx)
                        } else {
                            logger.warn('[DECISION] Grupo Whatbot no encontrado para notificacion de espera', {}, logCtx)
                            logger.categoryMetric('decision', 'wait_notify_group_missing', {}, logCtx)
                        }
                    } catch (waitNotifyErr) {
                        logger.warn('[DECISION] No se pudo enviar notificacion de espera al grupo', {}, logCtx)
                        logger.categoryMetric('decision', 'wait_notify_error', {}, logCtx)
                    }
                }
                return
            }

            const openaiStartedAt = Date.now()
            logger.info('[PIPELINE] Generando respuesta', {}, logCtx)
            const reply = await withTimeout(generateReply(combinedMessage, context, persona, contactNameForAI), 15000, 'generateReply')
            logger.metric('openai.generateReply.latency_ms', Date.now() - openaiStartedAt, {}, logCtx)
            logger.categoryMetric('openai', 'generate_reply', {}, logCtx)

            if (!reply) {
                logger.warn('[PIPELINE] No se genero respuesta', {}, logCtx)
                logger.categoryMetric('pipeline', 'empty_reply', {}, logCtx)
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
            logger.metric('pipeline.flow.latency_ms', Date.now() - flowStartedAt, {}, logCtx)
            logger.info('[PIPELINE] Flujo completado', { replyLength: reply.length }, logCtx)
            logger.categoryMetric('pipeline', 'completed', {}, logCtx)
        } catch (err) {
            logger.error('[PIPELINE] Error no controlado en callback del buffer', err, logCtx)
            logger.categoryMetric('pipeline', 'error', {}, logCtx)
        }
    })
}

module.exports = { handleMessage }