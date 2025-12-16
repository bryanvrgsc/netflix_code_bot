// Bot Status Server - WebSocket interno para comunicación con dashboard
import { WebSocketServer } from 'ws';

const BOT_WS_PORT = 3001;
let wss = null;
const clients = new Set();

// Estado del bot
let botStatus = {
    whatsapp: 'disconnected',
    gmail: 'disconnected',
    lastActivity: null,
    processing: null
};

// Iniciar servidor WebSocket del bot
export function startBotStatusServer() {
    if (wss) return; // Ya iniciado

    wss = new WebSocketServer({ port: BOT_WS_PORT });

    wss.on('connection', (ws) => {
        clients.add(ws);

        // Enviar estado inicial
        ws.send(JSON.stringify({
            type: 'status',
            data: botStatus
        }));

        ws.on('close', () => {
            clients.delete(ws);
        });
    });

    wss.on('error', (err) => {
        console.error('Error en WebSocket server del bot:', err.message);
    });

    console.log(`📡 Bot Status Server en ws://localhost:${BOT_WS_PORT}`);
}

// Broadcast a todos los clientes del dashboard
function broadcast(type, data) {
    if (!wss) return;

    const message = JSON.stringify({ type, data });
    clients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            client.send(message);
        }
    });
}

// Actualizar estado del bot
export function updateBotStatus(status) {
    botStatus = { ...botStatus, ...status };
    broadcast('status', botStatus);
}

// Notificar nuevo log
export function notifyNewLog(log) {
    broadcast('newLog', log);
}

// Notificar actividad en proceso
export function notifyProcessing(activity) {
    botStatus.processing = activity;
    botStatus.lastActivity = new Date().toISOString();
    broadcast('processing', activity);
}

// Obtener estado actual (para API REST)
export function getBotStatus() {
    return botStatus;
}
