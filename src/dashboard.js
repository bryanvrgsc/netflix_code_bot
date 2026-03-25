import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { getRecentLogs, getStats, getStatsHistory, getLogsByProfile } from './services/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 3000;
const BOT_WS_URL = 'ws://localhost:3001';

// Estado del bot (recibido del servicio principal)
let botStatus = {
    whatsapp: 'disconnected',
    gmail: 'disconnected',
    botConnected: false,
    lastActivity: null,
    processing: null
};

// Conexión al bot (WebSocket cliente)
let botConnection = null;
const dashboardClients = new Set();

function connectToBot() {
    try {
        botConnection = new WebSocket(BOT_WS_URL);

        botConnection.on('open', () => {
            console.log('✅ Conectado al servicio del bot');
            botStatus.botConnected = true;
            broadcastToDashboard('status', botStatus);
        });

        botConnection.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());

                // Actualizar estado local
                if (message.type === 'status') {
                    botStatus = { ...botStatus, ...message.data, botConnected: true };
                    // Enviar el estado completo (con botConnected) al dashboard
                    broadcastToDashboard('status', botStatus);
                } else {
                    // Reenviar otros tipos de mensajes tal cual
                    broadcastToDashboard(message.type, message.data);
                }
            } catch (e) {
                console.error('Error parseando mensaje del bot:', e);
            }
        });

        botConnection.on('close', () => {
            console.log('⚠️  Desconectado del servicio del bot');
            botStatus.botConnected = false;
            botStatus.whatsapp = 'disconnected';
            botStatus.gmail = 'disconnected';
            broadcastToDashboard('status', botStatus);

            // Reintentar conexión cada 5 segundos
            setTimeout(connectToBot, 5000);
        });

        botConnection.on('error', () => {
            // Error silencioso, se manejará en 'close'
        });

    } catch (error) {
        console.log('Bot no disponible, reintentando en 5s...');
        setTimeout(connectToBot, 5000);
    }
}

// Broadcast a clientes del dashboard
function broadcastToDashboard(type, data) {
    const message = JSON.stringify({ type, data });
    dashboardClients.forEach(client => {
        if (client.readyState === 1) {
            client.send(message);
        }
    });
}

// WebSocket para clientes del dashboard
wss.on('connection', (ws) => {
    dashboardClients.add(ws);

    // Enviar estado inicial
    ws.send(JSON.stringify({
        type: 'status',
        data: botStatus
    }));

    ws.on('close', () => {
        dashboardClients.delete(ws);
    });
});

app.use(express.json());
app.use(express.static(join(__dirname, '../dashboard/public')));

// API: Obtener logs recientes
app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const profile = req.query.profile;

    const logs = profile ? getLogsByProfile(profile, limit) : getRecentLogs(limit);
    res.json(logs);
});

// API: Obtener estadísticas
app.get('/api/stats', (req, res) => {
    const stats = getStats();
    res.json(stats);
});

// API: Obtener historial de estadísticas
app.get('/api/stats/history', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const history = getStatsHistory(days);
    res.json(history);
});

// API: Obtener contactos
app.get('/api/contacts', (req, res) => {
    try {
        const contactsPath = join(__dirname, '../contacts.json');
        const data = fs.readFileSync(contactsPath, 'utf8');
        const contacts = JSON.parse(data);
        res.json(contacts.profiles || {});
    } catch (error) {
        res.status(500).json({ error: 'Error leyendo contactos' });
    }
});

// API: Actualizar contactos
app.post('/api/contacts', (req, res) => {
    const profiles = req.body;

    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
        return res.status(400).json({ error: 'El body debe ser un objeto con perfiles' });
    }

    for (const [name, phone] of Object.entries(profiles)) {
        if (typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'El nombre de perfil no puede estar vacío' });
        }
        if (typeof phone !== 'string' || !/^\d{10,15}$/.test(phone)) {
            return res.status(400).json({ error: `Teléfono inválido para "${name}": debe contener solo dígitos con código de país (10-15 dígitos)` });
        }
    }

    try {
        const contactsPath = join(__dirname, '../contacts.json');
        fs.writeFileSync(contactsPath, JSON.stringify({ profiles }, null, 2));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error guardando contactos' });
    }
});

// API: Estado del sistema
app.get('/api/status', (req, res) => {
    res.json({
        ...botStatus,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Servir dashboard HTML
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, '../dashboard/public/index.html'));
});

// Iniciar servidor
server.listen(DASHBOARD_PORT, () => {
    console.log(`🖥️  Dashboard corriendo en http://localhost:${DASHBOARD_PORT}`);

    // Intentar conectar al servicio del bot
    connectToBot();
});

export default app;
