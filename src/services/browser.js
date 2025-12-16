import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper function para esperar (waitForTimeout está deprecado)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class BrowserService {
    constructor() {
        this.browser = null;
    }

    /**
     * Obtener la ruta de Chrome en el sistema
     */
    getChromePath() {
        const paths = [
            // macOS
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            // Linux
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            // Windows
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ];

        for (const path of paths) {
            if (fs.existsSync(path)) {
                return path;
            }
        }

        throw new Error('No se encontró Chrome/Chromium instalado. Por favor instala Google Chrome.');
    }

    /**
     * Inicializar navegador
     */
    async init() {
        if (this.browser) return;

        const chromePath = this.getChromePath();
        console.log(`🌐 Usando navegador: ${chromePath}`);

        this.browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: true, // Cambiar a false para ver el navegador
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
    }

    /**
     * Aprobar solicitud de Hogar de Netflix
     * @param {string} approveUrl - URL del botón "Sí, la envié yo"
     * @returns {object} - Resultado de la operación
     */
    async approveNetflixHogar(approveUrl) {
        await this.init();

        const page = await this.browser.newPage();

        try {
            console.log('🌐 Abriendo enlace de aprobación de Netflix...');

            // Configurar user agent para parecer un navegador real
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // Navegar a la URL de aprobación
            await page.goto(approveUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Esperar un momento para que cargue la página
            await delay(2000);

            // Tomar screenshot para debug (opcional)
            const screenshotPath = join(__dirname, '../../data/netflix-approval.png');
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 Screenshot guardado en: ${screenshotPath}`);

            // Buscar y hacer clic en el botón de confirmación
            // Netflix puede tener diferentes botones según el flujo
            const confirmButtons = [
                'button[data-uia="set-primary-location-action"]',
                'button[data-uia="confirm-btn"]',
                'button:has-text("Confirmar")',
                'button:has-text("Confirm")',
                'button:has-text("Confirmar actualización")',
                'button:has-text("Sí")',
                'button:has-text("Yes")',
                '.btn-blue',
                '.btn-submit',
                'button[type="submit"]'
            ];

            let clicked = false;

            for (const selector of confirmButtons) {
                try {
                    const button = await page.$(selector);
                    if (button) {
                        const isVisible = await button.isIntersectingViewport();
                        if (isVisible) {
                            await button.click();
                            console.log(`✅ Clic en botón: ${selector}`);
                            clicked = true;
                            break;
                        }
                    }
                } catch (e) {
                    // Continuar con el siguiente selector
                }
            }

            // Si no encontramos botón específico, buscar por texto
            if (!clicked) {
                try {
                    // Buscar cualquier botón que contenga texto de confirmación
                    const buttons = await page.$$('button');
                    for (const button of buttons) {
                        const text = await page.evaluate(el => el.textContent, button);
                        if (text && /confirm|confirmar|actualiza|sí|yes/i.test(text)) {
                            await button.click();
                            console.log(`✅ Clic en botón con texto: "${text.trim()}"`);
                            clicked = true;
                            break;
                        }
                    }
                } catch (e) {
                    console.log('⚠️ Error buscando botones por texto:', e.message);
                }
            }

            // Esperar a que se procese la acción
            await delay(3000);

            // Tomar screenshot final
            const finalScreenshotPath = join(__dirname, '../../data/netflix-approval-final.png');
            await page.screenshot({ path: finalScreenshotPath, fullPage: true });

            // Verificar si la página muestra éxito
            const pageContent = await page.content();
            const success = /gracias|thank|completado|completed|éxito|success|actualizado|updated/i.test(pageContent);

            await page.close();

            return {
                success: clicked || success,
                message: clicked ? 'Solicitud de Hogar aprobada automáticamente' : 'Página abierta pero no se encontró botón de confirmación',
                screenshotPath: finalScreenshotPath
            };

        } catch (error) {
            console.error('❌ Error en automatización de navegador:', error.message);

            // Tomar screenshot del error
            try {
                const errorScreenshotPath = join(__dirname, '../../data/netflix-error.png');
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
            } catch (e) { }

            await page.close();

            return {
                success: false,
                message: `Error: ${error.message}`,
                error: error
            };
        }
    }

    /**
     * Cerrar navegador
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

export default BrowserService;
