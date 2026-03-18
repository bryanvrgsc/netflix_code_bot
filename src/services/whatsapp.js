import { default as makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from 'baileys';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const authDir = join(__dirname, '../../data/whatsapp-auth');

// Logger silencioso para que no llene la consola
const logger = pino({ level: 'silent' });

export class WhatsAppService extends EventEmitter {
    constructor() {
        super();
        this.socket = null;
        this.isConnected = false;
        this.isConnecting = false;
    }

    /**
     * Conectar a WhatsApp
     */
    async connect() {
        if (this.isConnected || this.isConnecting) return;
        this.isConnecting = true;

        // Asegurar que existe el directorio de auth
        if (!fs.existsSync(authDir)) {
            fs.mkdirSync(authDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(authDir);

        // Obtener la versión más reciente de WhatsApp Web para evitar error 405
        const { version } = await fetchLatestBaileysVersion();
        console.log(`📱 Usando versión de WhatsApp Web: ${version.join('.')}`);

        return new Promise((resolve, reject) => {
            console.log('📱 Iniciando conexión con WhatsApp...');

            const socket = makeWASocket({
                auth: state,
                version,
                logger,
                browser: ['Mac OS', 'Safari', '10.15.7'],
                printQRInTerminal: false, // Lo manejamos nosotros
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 0,
                keepAliveIntervalMs: 10000,
                emitOwnEvents: true
            });

            this.socket = socket;

            // Timeout para escaneo de QR (solo la primera vez)
            let qrTimeout = setTimeout(() => {
                if (!this.isConnected && !this.isReconnecting) {
                    console.log('⚠️ Timeout esperando escaneo de QR');
                }
            }, 120000);

            // Manejar eventos de conexión
            socket.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                // Mostrar código QR cuando esté disponible
                if (qr) {
                    const qrcode = await import('qrcode-terminal');
                    console.log('\n📱 Escanea este código QR con WhatsApp:');
                    qrcode.default.generate(qr, { small: true });
                    console.log('   1. Abre WhatsApp en tu teléfono');
                    console.log('   2. Toca Menú ⋮ o Configuración ⚙️');
                    console.log('   3. Toca "Dispositivos vinculados"');
                    console.log('   4. Toca "Vincular un dispositivo"\n');
                }

                if (connection === 'close') {
                    clearTimeout(qrTimeout);
                    this.isConnected = false;
                    this.isConnecting = false;
                    this.emit('disconnected');

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const errorReason = lastDisconnect?.error?.message || 'Error desconocido';

                    console.log(`❌ WhatsApp desconectado: ${errorReason} (Status: ${statusCode})`);

                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log('👋 Sesión cerrada o expirada. Limpiando credenciales...');
                        if (fs.existsSync(authDir)) {
                            try {
                                fs.rmSync(authDir, { recursive: true, force: true });
                            } catch (e) {
                                console.error('Error eliminando sesión:', e.message);
                            }
                        }
                    }

                    if (shouldReconnect) {
                        console.log('🔄 Reconectando en 5 segundos...');
                        // Resolver el Promise original para no bloquear main()
                        // La reconexión continuará en segundo plano
                        resolve();
                        setTimeout(() => {
                            this.connect().catch(err => {
                                console.error('Error en intento de reconexión:', err.message);
                            });
                        }, 5000);
                    } else {
                        reject(new Error('Sesión de WhatsApp cerrada permanentemente'));
                    }
                }

                if (connection === 'open') {
                    clearTimeout(qrTimeout);
                    this.isConnected = true;
                    this.isConnecting = false;
                    console.log('✅ WhatsApp conectado exitosamente');
                    this.emit('connected');
                    resolve();
                }
            });

            // Guardar credenciales cuando se actualicen
            socket.ev.on('creds.update', saveCreds);
        });
    }

    /**
     * Enviar mensaje de WhatsApp
     */
    async sendMessage(phoneNumber, message) {
        if (!this.isConnected || !this.socket) {
            throw new Error('WhatsApp no está conectado');
        }

        const jid = `${phoneNumber}@s.whatsapp.net`;

        try {
            await this.socket.sendMessage(jid, { text: message });
            console.log(`📤 Mensaje enviado a ${phoneNumber}`);
            return true;
        } catch (error) {
            console.error(`Error enviando mensaje a ${phoneNumber}:`, error.message);
            throw error;
        }
    }

    /**
     * Enviar código de Netflix formateado
     */
    async sendNetflixCode(phoneNumber, code, profileName) {
        const message = `🎬 *Netflix - Código de Verificación*
👤 Perfil: *${profileName}*
🔐 Código: *${code}*
_Mensaje automático enviado por Netflix Code Bot_`;

        return this.sendMessage(phoneNumber, message);
    }

    /**
     * Enviar imagen por WhatsApp
     * @param {string} phoneNumber - Número de teléfono
     * @param {string} imagePath - Ruta absoluta a la imagen
     * @param {string} caption - Texto opcional debajo de la imagen
     */
    async sendImage(phoneNumber, imagePath, caption = '') {
        if (!this.isConnected || !this.socket) {
            throw new Error('WhatsApp no está conectado');
        }

        const jid = `${phoneNumber}@s.whatsapp.net`;

        try {
            const imageBuffer = fs.readFileSync(imagePath);
            await this.socket.sendMessage(jid, {
                image: imageBuffer,
                caption: caption
            });
            console.log(`📤 Imagen enviada a ${phoneNumber}`);
            return true;
        } catch (error) {
            console.error(`Error enviando imagen a ${phoneNumber}:`, error.message);
            throw error;
        }
    }

    /**
     * Desconectar
     */
    disconnect() {
        if (this.socket) {
            this.socket.end();
        }
        this.isConnected = false;
    }
}

export default WhatsAppService;
