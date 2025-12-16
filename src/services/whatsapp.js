import { default as makeWASocket, DisconnectReason, useMultiFileAuthState } from 'baileys';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const authDir = join(__dirname, '../../data/whatsapp-auth');

// Logger silencioso para que no llene la consola
const logger = pino({ level: 'silent' });

export class WhatsAppService {
    constructor() {
        this.socket = null;
        this.isConnected = false;
    }

    /**
     * Conectar a WhatsApp
     */
    async connect() {
        return new Promise(async (resolve, reject) => {
            // Asegurar que existe el directorio de auth
            if (!fs.existsSync(authDir)) {
                fs.mkdirSync(authDir, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(authDir);

            const socket = makeWASocket({
                auth: state,
                logger,
                browser: ['Netflix Code Bot', 'Chrome', '120.0.0']
            });

            this.socket = socket;

            // Timeout para escaneo de QR
            const timeout = setTimeout(() => {
                if (!this.isConnected) {
                    reject(new Error('Timeout: No se escaneó el código QR a tiempo (2 minutos)'));
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
                    clearTimeout(timeout);
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    console.log('❌ WhatsApp desconectado:', lastDisconnect?.error?.message || 'Error desconocido');

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log('👋 Sesión expirada. Limpiando credenciales...');
                        if (fs.existsSync(authDir)) {
                            fs.rmSync(authDir, { recursive: true });
                        }
                    }

                    if (shouldReconnect) {
                        console.log('🔄 Reconectando en 3 segundos...');
                        await new Promise(r => setTimeout(r, 3000));
                        this.connect().then(resolve).catch(reject);
                    } else {
                        reject(new Error('Sesión de WhatsApp cerrada'));
                    }
                }

                if (connection === 'open') {
                    clearTimeout(timeout);
                    this.isConnected = true;
                    console.log('✅ WhatsApp conectado exitosamente');
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
        const fs = await import('fs');

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
