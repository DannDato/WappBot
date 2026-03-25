# Configuración de División de Mensajes

## ¿Qué es?
Cuando el bot genera una respuesta muy larga (supera 1000 caracteres), automáticamente la divide en múltiples mensajes y los envía con un intervalo de tiempo entre ellos, simulando un comportamiento natural de WhatsApp.

## Parámetros Ajustables

Edita `services/messageSplitter.js` para cambiar estos valores:

```javascript
const MESSAGE_CONFIG = {
  // Umbral de caracteres: si el mensaje supera esto, se divide
  MAX_CHARS_PER_MESSAGE: 1000,      // ← Puedes cambiar esto (ej: 1500, 800, etc)
  
  // Intervalo (ms) entre envios de mensajes divididos
  INTERVAL_BETWEEN_MESSAGES: 600    // ← Puedes cambiar esto (ej: 1000, 300, etc)
}
```

## Ejemplos de Ajuste

### Si quieres mensajes más largos (menos división):
```javascript
MAX_CHARS_PER_MESSAGE: 1500  // Más caracteres = menos mensajes
INTERVAL_BETWEEN_MESSAGES: 500
```

### Si quieres mensajes más cortos (más división):
```javascript
MAX_CHARS_PER_MESSAGE: 700   // Menos caracteres = más mensajes
INTERVAL_BETWEEN_MESSAGES: 800
```

### Si quieres que los mensajes lleguen más rápido:
```javascript
INTERVAL_BETWEEN_MESSAGES: 200  // En ms (0.2 segundos)
```

### Si quieres que lleguen más lentamente:
```javascript
INTERVAL_BETWEEN_MESSAGES: 1500  // En ms (1.5 segundos)
```

## Cómo Funciona

1. **Generación de respuesta**: OpenAI genera la respuesta normalmente
2. **Evaluación**: El sistema verifica si la respuesta supera MAX_CHARS_PER_MESSAGE
3. **División**: Si es larga, la divide por párrafos (respetando saltos de línea)
4. **Envío**: Envía el primer mensaje como "reply" (40% de probabilidad) o "sendMessage" (60%)
5. **Intervalo**: Espera INTERVAL_BETWEEN_MESSAGES ms antes de enviar el siguiente
6. **Logs**: Cada mensaje registra en consola: `[MESSAGE] Mensaje X/Y enviado (N chars)`

## Dónde Se Aplica

✅ **Respuestas generadas por OpenAI**
✅ **Respuestas aprendidas del historial**
✅ **Mensajes de escalación** - También se dividen si son largos

## Logs Esperados

```
[MESSAGE] Enviando 3 mensaje(s) con umbral 1000 chars
[MESSAGE] Mensaje 1/3 enviado como reply (850 chars)
[MESSAGE] Mensaje 2/3 enviado (950 chars)
[MESSAGE] Mensaje 3/3 enviado (400 chars)
```

## Notas

- La división respeta párrafos (saltos de línea `\n`)
- Si un párrafo individual es más largo que MAX_CHARS_PER_MESSAGE, se divide también
- El intervalo corre entre TODOS los mensajes, incluido si hay reply al primero
- El timeout total para `sendSplitMessage` es 30 segundos (suficiente para varias divisiones)
