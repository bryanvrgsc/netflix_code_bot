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
    }

    /**
     * Conectar a Gmail usando IMAP IDLE (muy eficiente, casi 0 CPU)
     */
    async connect() {
        this.client = new ImapFlow(this.config);

        this.client.on('error', (err) => {
            console.error('❌ Error de IMAP:', err.message);
            this.emit('error', err);
        });

        this.client.on('close', () => {
            console.log('📧 Desconectado de Gmail');
            this.isConnected = false;
            this.emit('disconnected');
        });

        await this.client.connect();
        console.log('📧 Conectado a Gmail');
        this.isConnected = true;

        // Iniciar escucha de nuevos correos
        this.startListening();
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

            // Mantener conexión con IDLE
            this.keepAlive();

        } catch (error) {
            console.error('Error abriendo INBOX:', error.message);
            throw error;
        }
    }

    /**
     * Mantener conexión activa
     */
    async keepAlive() {
        // ImapFlow maneja IDLE automáticamente
        // Solo necesitamos mantener la conexión
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
            /<a[^>]+href=["'](https:\/\/[^"']*netflix[^"']*(?:confirm|update|approve|verify)[^"']*)["']/gi,
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
     * Reconectar
     */
    async reconnect() {
        console.log('🔄 Intentando reconectar...');
        await new Promise(r => setTimeout(r, 5000));
        return this.connect();
    }

    /**
     * Cerrar conexión
     */
    async disconnect() {
        if (this.client) {
            await this.client.logout();
        }
    }
}

export default GmailService;
