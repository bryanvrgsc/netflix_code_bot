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
     * Inicializar navegador (con detección de browser zombie)
     */
    async init() {
        // Verificar si el browser existente sigue funcional
        if (this.browser) {
            try {
                // isConnected() retorna false si el browser murió
                if (!this.browser.isConnected()) {
                    console.log('🌐 Browser zombie detectado, reinicializando...');
                    this.browser = null;
                } else {
                    return; // Browser sigue vivo, reutilizar
                }
            } catch (e) {
                console.log('🌐 Browser en estado inválido, reinicializando...');
                this.browser = null;
            }
        }

        const chromePath = this.getChromePath();
        console.log(`🌐 Lanzando nuevo navegador: ${chromePath}`);

        this.browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        // Limpiar referencia si el browser se desconecta inesperadamente
        this.browser.on('disconnected', () => {
            console.log('🌐 Browser se desconectó, será reinicializado en el próximo uso.');
            this.browser = null;
        });
    }

    /**
     * Aprobar solicitud de Hogar de Netflix
     * @param {string} approveUrl - URL del botón "Sí, la envié yo"
     * @returns {object} - Resultado de la operación
     */
    async approveNetflixHogar(approveUrl) {
        await this.init();

        let page;
        try {
            page = await this.browser.newPage();
        } catch (error) {
            // Si no podemos abrir página, el browser murió — resetear y reintentar
            console.log('🌐 Error abriendo página, reinicializando browser...');
            this.browser = null;
            await this.init();
            page = await this.browser.newPage();
        }

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

            // Tomar screenshot para debug
            const screenshotPath = join(__dirname, '../../data/netflix-approval.png');
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 Screenshot guardado en: ${screenshotPath}`);

            // Buscar y hacer clic en el botón/link de confirmación
            // Netflix usa tanto <button> como <a> estilizados como botones
            const confirmSelectors = [
                // Selectores específicos de Netflix
                'button[data-uia="set-primary-location-action"]',
                'a[data-uia="set-primary-location-action"]',
                'button[data-uia="confirm-btn"]',
                'a[data-uia="confirm-btn"]',
                // Clases de botón comunes de Netflix
                '.btn-blue',
                '.btn-submit',
                'a.btn-blue',
                'a.btn-submit',
                // Genéricos
                'button[type="submit"]',
                'a[role="button"]',
            ];

            let clicked = false;

            for (const selector of confirmSelectors) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        const isVisible = await element.isIntersectingViewport();
                        if (isVisible) {
                            await element.click();
                            console.log(`✅ Clic en elemento: ${selector}`);
                            clicked = true;
                            break;
                        }
                    }
                } catch (e) {
                    // Continuar con el siguiente selector
                }
            }

            // Si no encontramos por selector, buscar <button> Y <a> por texto
            if (!clicked) {
                try {
                    const clickableElements = await page.$$('button, a');
                    for (const el of clickableElements) {
                        const text = await page.evaluate(e => e.textContent, el);
                        if (text && /confirm|confirmar|actualiza|sí,?\s*la\s*envié|yes/i.test(text)) {
                            const isVisible = await el.isIntersectingViewport().catch(() => true);
                            if (isVisible) {
                                await el.click();
                                console.log(`✅ Clic en elemento con texto: "${text.trim().substring(0, 50)}"`);
                                clicked = true;
                                break;
                            }
                        }
                    }
                } catch (e) {
                    console.log('⚠️ Error buscando elementos por texto:', e.message);
                }
            }

            // Esperar a que se procese la acción
            await delay(3000);

            // Tomar screenshot final
            const finalScreenshotPath = join(__dirname, '../../data/netflix-approval-final.png');
            await page.screenshot({ path: finalScreenshotPath, fullPage: true });

            // Verificar si la página muestra éxito
            const pageContent = await page.content();
            const success = /gracias|thank|completado|completed|éxito|success|actualizado|updated|reanudarse|confirmado/i.test(pageContent);

            await page.close();

            return {
                success: clicked || success,
                message: clicked ? 'Solicitud de Hogar aprobada automáticamente' : (success ? 'Página indica éxito' : 'No se encontró botón de confirmación'),
                screenshotPath: finalScreenshotPath
            };

        } catch (error) {
            console.error('❌ Error en automatización de navegador:', error.message);

            // Tomar screenshot del error
            try {
                const errorScreenshotPath = join(__dirname, '../../data/netflix-error.png');
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
            } catch (e) { }

            try { await page.close(); } catch (e) { }

            // Si es error de conexión, resetear browser para el próximo intento
            if (error.message.includes('Connection closed') || error.message.includes('Protocol error') || error.message.includes('Target closed')) {
                console.log('🌐 Reseteando browser por error de conexión...');
                this.browser = null;
            }

            return {
                success: false,
                message: `Error: ${error.message}`,
                screenshotPath: join(__dirname, '../../data/netflix-error.png')
            };
        }
    }

    /**
     * Cerrar navegador
     */
    async close() {
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (e) { }
            this.browser = null;
        }
    }
}

export default BrowserService;
