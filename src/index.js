import 'dotenv/config';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import chalk from 'chalk';

import GmailService from './services/gmail.js';
import WhatsAppService from './services/whatsapp.js';
import BrowserService from './services/browser.js';
import { logCodeSent, isCodeProcessed, getStats } from './services/database.js';
import { startBotStatusServer, updateBotStatus, notifyNewLog, notifyProcessing } from './services/botStatus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar configuración de contactos
const contactsPath = join(__dirname, '../contacts.json');
let contacts = {};

function loadContacts() {
    try {
        const data = fs.readFileSync(contactsPath, 'utf8');
        contacts = JSON.parse(data).profiles || {};
        console.log(chalk.cyan(`📇 Cargados ${Object.keys(contacts).length} contactos`));
    } catch (error) {
        console.error(chalk.red('❌ Error cargando contacts.json:'), error.message);
        console.log(chalk.yellow('⚠️  Crea el archivo contacts.json con los perfiles de Netflix'));
        process.exit(1);
    }
}

// Banner de inicio
function showBanner() {
    console.log(chalk.red(`
  ███╗   ██╗███████╗████████╗███████╗██╗     ██╗██╗  ██╗
  ████╗  ██║██╔════╝╚══██╔══╝██╔════╝██║     ██║╚██╗██╔╝
  ██╔██╗ ██║█████╗     ██║   █████╗  ██║     ██║ ╚███╔╝ 
  ██║╚██╗██║██╔══╝     ██║   ██╔══╝  ██║     ██║ ██╔██╗ 
  ██║ ╚████║███████╗   ██║   ██║     ███████╗██║██╔╝ ██╗
  ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝     ╚══════╝╚═╝╚═╝  ╚═╝
  `));
    console.log(chalk.white('  📺 Netflix Code Bot - Envío automático de códigos por WhatsApp'));
    console.log(chalk.gray('  ─────────────────────────────────────────────────────────────\n'));
}

// Servicio principal
async function main() {
    showBanner();
    loadContacts();

    // Verificar variables de entorno
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        console.error(chalk.red('❌ Falta configurar GMAIL_USER y GMAIL_APP_PASSWORD en .env'));
        console.log(chalk.yellow('\n📝 Pasos para configurar:'));
        console.log(chalk.white('   1. Copia .env.example a .env'));
        console.log(chalk.white('   2. Agrega tu correo de Gmail'));
        console.log(chalk.white('   3. Genera una contraseña de aplicación en:'));
        console.log(chalk.cyan('      https://myaccount.google.com/apppasswords'));
        process.exit(1);
    }

    // Inicializar servicios
    const gmail = new GmailService({
        user: process.env.GMAIL_USER,
        password: process.env.GMAIL_APP_PASSWORD
    });

    const whatsapp = new WhatsAppService();
    const browser = new BrowserService();

    // Manejar códigos de Netflix detectados
    gmail.on('netflixCode', async (data) => {
        console.log(chalk.green('\n🎬 ¡Código de Netflix detectado!'));
        console.log(chalk.white(`   Perfil: ${chalk.bold(data.profile)}`));
        console.log(chalk.white(`   Código: ${chalk.bold(data.code)}`));

        // Verificar si ya procesamos este código
        if (isCodeProcessed(data.code, data.profile)) {
            console.log(chalk.yellow('⚠️  Este código ya fue enviado anteriormente'));
            return;
        }

        // Buscar número de WhatsApp del perfil
        const phoneNumber = contacts[data.profile];

        if (!phoneNumber) {
            console.log(chalk.yellow(`⚠️  No hay número configurado para el perfil "${data.profile}"`));
            console.log(chalk.gray('   Agrega este perfil en contacts.json'));

            logCodeSent({
                profileName: data.profile,
                code: data.code,
                phoneNumber: 'NO_CONFIGURADO',
                status: 'failed',
                errorMessage: 'Perfil no configurado en contacts.json',
                emailSubject: data.subject,
                emailFrom: data.from
            });
            return;
        }

        // Enviar por WhatsApp
        try {
            notifyProcessing({ message: `📤 Enviando código a ${data.profile}...` });

            await whatsapp.sendNetflixCode(phoneNumber, data.code, data.profile);

            console.log(chalk.green(`✅ Código enviado a ${data.profile} (${phoneNumber})`));

            const logData = {
                profileName: data.profile,
                code: data.code,
                phoneNumber: phoneNumber,
                status: 'sent',
                emailSubject: data.subject,
                emailFrom: data.from
            };
            logCodeSent(logData);
            notifyNewLog({ profile_name: data.profile, code: data.code, phone_number: phoneNumber, status: 'sent', timestamp: new Date().toISOString() });
            notifyProcessing(null);

        } catch (error) {
            console.error(chalk.red(`❌ Error enviando a ${data.profile}:`), error.message);

            const logData = {
                profileName: data.profile,
                code: data.code,
                phoneNumber: phoneNumber,
                status: 'failed',
                errorMessage: error.message,
                emailSubject: data.subject,
                emailFrom: data.from
            };
            logCodeSent(logData);
            notifyNewLog({ profile_name: data.profile, code: data.code, phone_number: phoneNumber, status: 'failed', timestamp: new Date().toISOString() });
            notifyProcessing(null);
        }
    });

    // Manejar solicitudes de Hogar de Netflix (sin código) - CLIC AUTOMÁTICO
    gmail.on('netflixHogar', async (data) => {
        console.log(chalk.blue('\n🏠 ¡Solicitud de Hogar Netflix detectada!'));
        console.log(chalk.white(`   Perfil: ${chalk.bold(data.profile)}`));
        console.log(chalk.white(`   Mensaje: ${data.message}`));

        // Buscar número de WhatsApp del perfil
        const phoneNumber = contacts[data.profile];

        if (!phoneNumber) {
            console.log(chalk.yellow(`⚠️  No hay número configurado para el perfil "${data.profile}"`));
            console.log(chalk.gray('   Agrega este perfil en contacts.json'));

            logCodeSent({
                profileName: data.profile,
                code: 'HOGAR',
                phoneNumber: 'NO_CONFIGURADO',
                status: 'failed',
                errorMessage: 'Perfil no configurado en contacts.json',
                emailSubject: data.subject,
                emailFrom: data.from
            });
            return;
        }

        // ===== CLIC AUTOMÁTICO EN EL ENLACE DE APROBACIÓN =====
        let approvalResult = { success: false, message: 'No se encontró URL de aprobación' };

        if (data.approveUrl) {
            console.log(chalk.cyan('🖱️  Haciendo clic automático en el enlace de aprobación...'));
            console.log(chalk.gray(`   URL: ${data.approveUrl.substring(0, 80)}...`));
            notifyProcessing({ message: `🖱️ Aprobando Hogar para ${data.profile}...` });

            try {
                approvalResult = await browser.approveNetflixHogar(data.approveUrl);

                if (approvalResult.success) {
                    console.log(chalk.green('✅ ¡Solicitud de Hogar APROBADA automáticamente!'));
                } else {
                    console.log(chalk.yellow(`⚠️  Resultado: ${approvalResult.message}`));
                }
            } catch (error) {
                console.error(chalk.red('❌ Error haciendo clic automático:'), error.message);
                approvalResult = { success: false, message: error.message };
            }
        } else {
            console.log(chalk.yellow('⚠️  No se encontró URL de aprobación en el correo'));
        }

        // Solo enviar WhatsApp si la aprobación fue exitosa
        if (approvalResult.success) {
            try {
                const message = `🏠 *Netflix - Hogar Actualizado* ✅
👤 Perfil: *${data.profile}*
_Mensaje automático enviado por Netflix Code Bot_`;

                await whatsapp.sendMessage(phoneNumber, message);

                console.log(chalk.green(`✅ Notificación enviada a ${data.profile} (${phoneNumber})`));

                logCodeSent({
                    profileName: data.profile,
                    code: 'HOGAR_APROBADO',
                    phoneNumber: phoneNumber,
                    status: 'sent',
                    emailSubject: data.subject,
                    emailFrom: data.from
                });
                notifyNewLog({ profile_name: data.profile, code: 'HOGAR_APROBADO', phone_number: phoneNumber, status: 'sent', timestamp: new Date().toISOString() });
                notifyProcessing(null);

            } catch (error) {
                console.error(chalk.red(`❌ Error enviando a ${data.profile}:`), error.message);

                logCodeSent({
                    profileName: data.profile,
                    code: 'HOGAR_APROBADO',
                    phoneNumber: phoneNumber,
                    status: 'failed',
                    errorMessage: error.message,
                    emailSubject: data.subject,
                    emailFrom: data.from
                });
                notifyNewLog({ profile_name: data.profile, code: 'HOGAR_APROBADO', phone_number: phoneNumber, status: 'failed', timestamp: new Date().toISOString() });
                notifyProcessing(null);
            }
        } else {
            // Enviar alerta al admin con screenshot
            const adminPhone = process.env.ADMIN_PHONE;
            if (adminPhone && approvalResult.screenshotPath) {
                try {
                    const caption = `⚠️ *Error en aprobación automática*
👤 Perfil: *${data.profile}*
❌ ${approvalResult.message}`;

                    await whatsapp.sendImage(adminPhone, approvalResult.screenshotPath, caption);
                    console.log(chalk.yellow(`📸 Screenshot de error enviado al admin`));
                } catch (imgError) {
                    console.error(chalk.red('Error enviando screenshot al admin:'), imgError.message);
                }
            }

            // Registrar en log
            logCodeSent({
                profileName: data.profile,
                code: 'HOGAR_PENDIENTE',
                phoneNumber: phoneNumber,
                status: 'pending',
                errorMessage: approvalResult.message,
                emailSubject: data.subject,
                emailFrom: data.from
            });
            notifyNewLog({ profile_name: data.profile, code: 'HOGAR_PENDIENTE', phone_number: phoneNumber, status: 'pending', timestamp: new Date().toISOString() });
            notifyProcessing(null);
        }
    });

    // Manejar errores de Gmail
    gmail.on('error', async (error) => {
        console.error(chalk.red('❌ Error de Gmail:'), error.message);
        updateBotStatus({ gmail: 'disconnected' });
        await gmail.reconnect();
    });

    gmail.on('disconnected', async () => {
        console.log(chalk.yellow('⚠️  Gmail desconectado, reconectando...'));
        updateBotStatus({ gmail: 'disconnected' });
        await gmail.reconnect();
    });

    // Conectar WhatsApp primero
    console.log(chalk.cyan('📱 Conectando a WhatsApp...'));
    try {
        await whatsapp.connect();
        updateBotStatus({ whatsapp: 'connected' });
    } catch (error) {
        console.error(chalk.red('❌ Error conectando WhatsApp:'), error.message);
        console.log(chalk.yellow('Intenta nuevamente. Asegúrate de escanear el código QR.'));
        process.exit(1);
    }

    // Conectar a Gmail
    console.log(chalk.cyan('\n📧 Conectando a Gmail...'));
    await gmail.connect();
    updateBotStatus({ gmail: 'connected' });

    // Iniciar servidor de estado del bot (para comunicación con dashboard)
    startBotStatusServer();

    // Mostrar estadísticas
    const stats = getStats();
    console.log(chalk.cyan('\n📊 Estadísticas:'));
    console.log(chalk.white(`   Total de códigos: ${stats.total.codes}`));
    console.log(chalk.green(`   Enviados: ${stats.total.sent}`));
    console.log(chalk.red(`   Fallidos: ${stats.total.failed}`));

    // Mostrar contactos configurados
    console.log(chalk.cyan('\n📇 Contactos configurados:'));
    for (const [profile, phone] of Object.entries(contacts)) {
        console.log(chalk.white(`   ${profile} → ${phone}`));
    }

    console.log(chalk.green('\n✨ Bot iniciado correctamente'));
    console.log(chalk.gray('   Esperando correos de Netflix...\n'));
    console.log(chalk.gray(`   Dashboard: http://localhost:${process.env.DASHBOARD_PORT || 3000}`));
    console.log(chalk.gray('   Presiona Ctrl+C para detener\n'));

    // Manejar cierre graceful
    process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n\n👋 Deteniendo bot...'));
        gmail.disconnect();
        whatsapp.disconnect();
        await browser.close();
        process.exit(0);
    });
}

// Iniciar
main().catch((error) => {
    console.error(chalk.red('Error fatal:'), error);
    process.exit(1);
});
