import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { EventEmitter } from 'events';

export class GmailService extends EventEmitter {
    constructor(config) {
        super();
        this.config = {
            host: 'imap.gmail.com',
            port: 993,
            secure: true,
            auth: {
                user: config.user,
                pass: config.password
            },
            logger: false
        };
        this.client = null;
        this.isConnected = false;
        this.isReconnecting = false;
        this.isConnecting = false;
        this._isDisconnecting = false;

        // Exponential backoff state
        this._reconnectAttempts = 0;
        this._baseReconnectDelay = 30000;  // 30s initial
        this._maxReconnectDelay = 300000;  // 5min max

        // Heartbeat
        this._heartbeatInterval = null;
        this._heartbeatFrequency = 240000; // 4 minutes
    }

    /**
     * Conectar a Gmail usando IMAP IDLE (muy eficiente, casi 0 CPU)
     */
    async connect() {
        if (this.isConnected || this.isConnecting) return;
        this.isConnecting = true;

        // Limpiar cliente anterior si existe
        await this._destroyClient();

        console.log(`📧 Intentando conectar a Gmail (${this.config.auth.user})...`);
        this.client = new ImapFlow(this.config);

        this.client.on('error', (err) => {
            if (err.authenticationFailed) {
                console.error('❌ ERROR CRÍTICO DE AUTENTICACIÓN: Usuario o contraseña de aplicación incorrectos.');
                console.log('   Revisa que IMAP esté habilitado en Gmail y que la contraseña de aplicación sea correcta.');
                this.isConnected = false;
                this.isConnecting = false;
                this.emit('error', err);
                return; // No reintentar automáticamente si es error de auth
            }

            console.error('❌ Error de IMAP:', err.message);
            this._handleDisconnect('error');
        });

        this.client.on('close', () => {
            if (this.isConnected || this.isConnecting) {
                console.log('📧 Desconectado de Gmail');
                this._handleDisconnect('close');
            }
        });

        try {
            await this.client.connect();
            console.log('✅ Gmail conectado satisfactoriamente');
            this.isConnected = true;
            this.isConnecting = false;

            // Reset backoff on successful connection
            this._reconnectAttempts = 0;

            // Iniciar escucha de nuevos correos
            await this.startListening();
        } catch (error) {
            if (error.authenticationFailed) {
                console.error('❌ Error de autenticación en connect():', error.message);
                this.isConnected = false;
                this.isConnecting = false;
                throw error;
            }
            console.error('❌ Error conectando a Gmail:', error.message);
            this.isConnected = false;
            this.isConnecting = false;
            this.reconnect();
            throw error;
        }
    }

    /**
     * Manejo centralizado de desconexión (evita race conditions entre error/close)
     */
    _handleDisconnect(source) {
        if (this._isDisconnecting) return;
        this._isDisconnecting = true;

        console.log(`📧 Desconexión detectada (${source}), preparando reconexión...`);
        this._stopHeartbeat();
        this.isConnected = false;
        this.isConnecting = false;
        this.emit('disconnected');

        // Dar tiempo a que el otro evento (error/close) se ignore
        setTimeout(() => {
            this._isDisconnecting = false;
            this.reconnect();
        }, 100);
    }

    /**
     * Escuchar nuevos correos usando IDLE
     */
    async startListening() {
        try {
            // Seleccionar INBOX
            await this.client.mailboxOpen('INBOX');
            console.log('📥 INBOX abierto, escuchando nuevos correos...');

            // Escuchar eventos de nuevos correos
            this.client.on('exists', async (data) => {
                console.log(`📬 Nuevo(s) correo(s) detectado(s)`);
                await this.checkForNetflixEmails();
            });

            // Iniciar heartbeat para detectar conexiones muertas
            this._startHeartbeat();

        } catch (error) {
            console.error('Error abriendo INBOX:', error.message);
            throw error;
        }
    }

    /**
     * Heartbeat: envía NOOP cada 4 minutos para detectar conexiones muertas
     */
    _startHeartbeat() {
        this._stopHeartbeat();
        this._heartbeatInterval = setInterval(async () => {
            if (!this.isConnected || !this.client) return;
            try {
                await this.client.noop();
            } catch (error) {
                console.error('💓 Heartbeat falló:', error.message);
                this._handleDisconnect('heartbeat');
            }
        }, this._heartbeatFrequency);
    }

    /**
     * Detener heartbeat
     */
    _stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
    }

    /**
     * Buscar correos de Netflix no leídos
     */
    async checkForNetflixEmails() {
        try {
            // Buscar correos de Netflix no leídos
            const messages = [];

            for await (const message of this.client.fetch(
                { seen: false, from: 'netflix' },
                { source: true, uid: true }
            )) {
                messages.push(message);
            }

            if (messages.length === 0) {
                console.log('No hay correos de Netflix nuevos');
                return [];
            }

            console.log(`🎬 Encontrados ${messages.length} correo(s) de Netflix`);

            // Procesar cada mensaje
            for (const msg of messages) {
                try {
                    const parsed = await simpleParser(msg.source);
                    const netflixData = this.extractNetflixData(parsed);

                    if (netflixData) {
                        // Marcar como leído
                        await this.client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen']);

                        // Emitir evento según el tipo
                        if (netflixData.type === 'code') {
                            this.emit('netflixCode', netflixData);
                        } else if (netflixData.type === 'hogar') {
                            this.emit('netflixHogar', netflixData);
                        }
                    }
                } catch (parseError) {
                    console.error('Error parseando correo:', parseError.message);
                }
            }

            return messages;

        } catch (error) {
            console.error('Error buscando correos:', error.message);
            return [];
        }
    }

    /**
     * Extraer información del correo de Netflix
     */
    extractNetflixData(email) {
        const subject = email.subject || '';
        const text = email.text || '';
        const html = email.html || '';
        const content = text + ' ' + html;

        // Detectar tipo de correo
        const isHogarEmail = /hogar|actualizar.*hogar|solicitud.*hogar/i.test(subject + ' ' + content);
        const isCodeEmail = /código|code|verificación|verification|contraseña temporal/i.test(subject + ' ' + content);

        // Patrones para extraer el perfil
        const profilePatterns = [
            /Solicitud\s+de\s+([A-Za-záéíóúñüÁÉÍÓÚÑÜ][A-Za-záéíóúñüÁÉÍÓÚÑÜ\s]*?)\s*,/i,
            /Solicitud\s+de\s+([A-Za-záéíóúñüÁÉÍÓÚÑÜ][A-Za-záéíóúñüÁÉÍÓÚÑÜ\s]*?)(?:\s+enviada|\s*$)/i,
            /Solicitada\s+por\s+([A-Za-záéíóúñüÁÉÍÓÚÑÜ][A-Za-záéíóúñüÁÉÍÓÚÑÜ\s]*?)(?:\s+a\s+las|\s*,|\s*$)/i,
            /Solicitud\s+de\s*<[^>]*>\s*([A-Za-záéíóúñüÁÉÍÓÚÑÜ][A-Za-záéíóúñüÁÉÍÓÚÑÜ\s]*?)\s*<\//i,
            /perfil[:\s]+["']?([A-Za-záéíóúñüÁÉÍÓÚÑÜ][A-Za-záéíóúñüÁÉÍÓÚÑÜ\s]*?)["']?(?:,|\.|$|\s+el|\s+desde)/i,
        ];

        // Patrones para extraer el código
        const codePatterns = [
            /código[:\s]+(\d{4,8})/i,
            /code[:\s]+(\d{4,8})/i,
            /verificación[:\s]+(\d{4,8})/i,
            /contraseña temporal[:\s]+(\d{4,8})/i,
            /<(?:strong|b|span|div|p)[^>]*>\s*(\d{4,8})\s*<\/(?:strong|b|span|div|p)>/i,
        ];

        // Patrones para URL de aprobación
        const urlPatterns = [
            /<a[^>]+href=["']([^"']+)["'][^>]*>[^<]*(?:sí|si|yes)[^<]*(?:envié|envie|sent)[^<]*<\/a>/gi,
            /https:\/\/[^"'\s]+netflix[^"'\s]*(?:update|confirm|approve|verify)[^"'\s]*/gi,
            /<a[^>]+href=["'](https:\/\/[^"']*netflix[^"']*(?:confirm|update|approve|verify)[^"']*)['"]/gi,
        ];

        let profile = null;
        let code = null;
        let approveUrl = null;

        // Buscar perfil
        for (const pattern of profilePatterns) {
            const match = content.match(pattern);
            if (match && match[1]) {
                profile = match[1].trim().replace(/[<>]/g, '').trim();
                if (profile.length > 0 && profile.length < 30) break;
                profile = null;
            }
        }

        // Buscar código
        if (isCodeEmail || !isHogarEmail) {
            for (const pattern of codePatterns) {
                const match = content.match(pattern);
                if (match && match[1]) {
                    code = match[1].trim();
                    break;
                }
            }
        }

        // Buscar URL de aprobación
        for (const pattern of urlPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
                const url = match[1] || match[0];
                if (url && !url.includes('unsubscribe') && !url.includes('help')) {
                    approveUrl = url.replace(/&amp;/g, '&');
                    break;
                }
            }
            if (approveUrl) break;
        }

        // Debug
        console.log(`   📋 Debug - Asunto: "${subject}"`);
        console.log(`   📋 Debug - Perfil: ${profile || 'NO DETECTADO'}`);
        console.log(`   📋 Debug - Código: ${code || 'SIN CÓDIGO'}`);
        console.log(`   📋 Debug - URL: ${approveUrl ? 'ENCONTRADA' : 'NO'}`);

        // Retornar datos según tipo
        if (code) {
            return {
                type: 'code',
                code,
                profile: profile || 'Desconocido',
                subject,
                from: email.from?.text || 'Netflix',
                date: email.date || new Date()
            };
        }

        if (isHogarEmail && profile) {
            return {
                type: 'hogar',
                profile,
                approveUrl,
                subject,
                from: email.from?.text || 'Netflix',
                date: email.date || new Date(),
                message: `${profile} solicita actualizar el Hogar de Netflix`
            };
        }

        return null;
    }

    /**
     * Reconectar con exponential backoff (30s → 60s → 120s → ... → max 5min)
     */
    async reconnect() {
        if (this.isReconnecting || this.isConnected) return;
        this.isReconnecting = true;

        this._reconnectAttempts++;
        const delay = Math.min(
            this._baseReconnectDelay * Math.pow(2, this._reconnectAttempts - 1),
            this._maxReconnectDelay
        );
        const delaySec = Math.round(delay / 1000);

        console.log(`🔄 Reconectando Gmail en ${delaySec}s (intento #${this._reconnectAttempts})...`);
        await new Promise(r => setTimeout(r, delay));
        
        this.isReconnecting = false;
        try {
            await this.connect();
        } catch (e) {
            // El error ya se maneja dentro de connect()
        }
    }

    /**
     * Destruir cliente IMAP anterior de forma segura
     */
    async _destroyClient() {
        this._stopHeartbeat();

        if (this.client) {
            const oldClient = this.client;
            this.client = null;

            // Remover listeners para evitar reconexiones fantasma
            oldClient.removeAllListeners();

            try {
                if (oldClient.usable) {
                    await oldClient.logout();
                }
            } catch (e) {
                // Ignorar errores al cerrar cliente viejo
            }

            try {
                oldClient.close();
            } catch (e) {
                // Ignorar
            }
        }
    }

    /**
     * Cerrar conexión limpiamente
     */
    async disconnect() {
        this._stopHeartbeat();
        this.isConnected = false;
        this.isConnecting = false;
        await this._destroyClient();
    }
}

export default GmailService;
