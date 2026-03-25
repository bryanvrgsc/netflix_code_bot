import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getRecentLogs, getStats, getStatsHistory, getLogsByProfile } from './services/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 3000;
const BOT_WS_URL = 'ws://localhost:3001';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

// Token HMAC determinístico — sobrevive reinicios sin necesitar estado en memoria
function makeToken(password) {
    return crypto.createHmac('sha256', 'netflix-bot-dashboard').update(password).digest('hex');
}

function parseCookies(cookieHeader = '') {
    return Object.fromEntries(
        cookieHeader.split(';').map(c => c.trim().split('=').map(decodeURIComponent))
    );
}

function requireAuth(req, res, next) {
    if (!DASHBOARD_PASSWORD) return next();
    if (req.path === '/login' || req.path === '/api/login') return next();
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.dbt === makeToken(DASHBOARD_PASSWORD)) return next();
    res.redirect('/login');
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Netflix Bot - Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; background: linear-gradient(135deg, #141414 0%, #1a0a0a 100%); color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: rgba(42,42,42,0.9); border-radius: 12px; padding: 40px 36px; width: 100%; max-width: 360px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
    h1 { font-size: 1.4rem; margin-bottom: 8px; }
    p { color: #808080; font-size: 0.85rem; margin-bottom: 28px; }
    label { font-size: 0.8rem; color: #aaa; display: block; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.95rem; outline: none; margin-bottom: 20px; }
    input:focus { border-color: #E50914; }
    button { width: 100%; padding: 11px; background: #E50914; border: none; border-radius: 8px; color: #fff; font-size: 0.95rem; font-weight: 600; cursor: pointer; }
    button:hover { background: #B81D24; }
    .error { color: #e87c03; font-size: 0.82rem; margin-bottom: 14px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎬 Netflix Bot</h1>
    <p>Ingresa la contraseña del dashboard</p>
    <div class="error" id="err">Contraseña incorrecta</div>
    <label>Contraseña</label>
    <input type="password" id="pwd" autofocus />
    <button onclick="login()">Entrar</button>
  </div>
  <script>
    document.getElementById('pwd').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    async function login() {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: document.getElementById('pwd').value }) });
      if (res.ok) { window.location.href = '/'; }
      else { document.getElementById('err').style.display = 'block'; }
    }
  </script>
</body>
</html>`;

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
wss.on('connection', (ws, req) => {
    if (DASHBOARD_PASSWORD) {
        const cookies = parseCookies(req.headers.cookie);
        if (cookies.dbt !== makeToken(DASHBOARD_PASSWORD)) {
            ws.close(1008, 'Unauthorized');
            return;
        }
    }

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
app.use(requireAuth);
app.use(express.static(join(__dirname, '../dashboard/public')));

// Login
app.get('/login', (req, res) => res.send(LOGIN_HTML));

app.post('/api/login', (req, res) => {
    if (!DASHBOARD_PASSWORD) return res.json({ ok: true });
    if (req.body.password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });
    const token = makeToken(DASHBOARD_PASSWORD);
    res.setHeader('Set-Cookie', `dbt=${token}; HttpOnly; SameSite=Strict; Path=/`);
    res.json({ ok: true });
});

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
