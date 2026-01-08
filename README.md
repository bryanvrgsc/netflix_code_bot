# 📺 Netflix Code Bot

Bot automatizado para enviar códigos de verificación de Netflix por WhatsApp, con
aprobación automática de solicitudes de Hogar.

## ✨ Características

- 📧 **Detección automática**: Escucha correos de Netflix en tiempo real (IMAP
  IDLE con imapflow)
- 📱 **WhatsApp automático**: Envía códigos al contacto correcto según el perfil
- 🏠 **Aprobación de Hogar**: Hace clic automático en enlaces de aprobación de
  Netflix
- 📸 **Alertas al admin**: Si falla la aprobación, envía screenshot al
  administrador
- 🪶 **Ultra liviano**: Bot y Dashboard como servicios separados
- 📊 **Dashboard en tiempo real**: WebSocket para actualizaciones instantáneas
- 💾 **Logs**: Registro SQLite de todos los códigos enviados

## 🏗️ Arquitectura

```text
┌──────────────────────┐         ┌─────────────────────┐
│   pnpm start         │ ◄─────► │  pnpm run dashboard │
│   (Bot ligero)       │  ws://  │  (Dashboard web)    │
│   Puerto: 3001       │  3001   │  Puerto: 3000       │
│   WhatsApp + Gmail   │         │  UI + Historial     │
└──────────────────────┘         └─────────────────────┘
```

- **Bot (ligero)**: Procesa correos y envía WhatsApp. Expone WebSocket en puerto
  3001.
- **Dashboard (opcional)**: Interfaz web que se conecta al bot para estado en
  tiempo real.

## 🚀 Instalación

### 1. Instalar dependencias

```bash
cd netflix-code-bot
pnpm install
```

> Si usas npm: `npm install`

### 2. Compilar dependencias nativas

```bash
cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
npm run build-release
```

### 3. Configurar Gmail

1. Copia el archivo de ejemplo:

   ```bash
   cp .env.example .env
   ```

2. Genera una **Contraseña de Aplicación** de Gmail:
   - Ve a: <https://myaccount.google.com/apppasswords>
   - Selecciona "Correo" y "Mac"
   - Copia la contraseña de 16 caracteres

3. Edita `.env` con tus datos:

   ```text
   GMAIL_USER=tu_correo@gmail.com
   GMAIL_APP_PASSWORD=xxxx_xxxx_xxxx_xxxx
   ADMIN_PHONE=521234567890
   ```

### 4. Configurar Contactos

Edita `contacts.json` con los perfiles de Netflix y números de WhatsApp:

```json
{
  "profiles": {
    "Mamá": "521234567890",
    "Papá": "521234567891",
    "Hermano": "521234567892"
  }
}
```

> ⚠️ Los números deben incluir código de país sin + ni espacios (ej: 52 para
> México)

## 🎮 Uso

### Iniciar el bot (ligero)

```bash
pnpm start
```

La primera vez te pedirá escanear un código QR con WhatsApp:

1. Abre WhatsApp en tu teléfono
2. Ve a **Configuración > Dispositivos vinculados**
3. Escanea el código QR

### Ver dashboard (opcional)

En otra terminal:

```bash
pnpm run dashboard
```

Accede a: <http://localhost:3000>

El dashboard muestra:

- 🤖 **Estado del bot**: Activo/Inactivo
- 📱 **WhatsApp**: Conectado/Desconectado
- 📧 **Gmail**: Conectado/Desconectado
- 📋 **Historial en tiempo real**: Logs instantáneos
- 📇 **Filtro por contacto**: Click para filtrar

## 🔄 Ejecutar automáticamente al iniciar Mac

### Opción 1: Script de inicio

Crea un archivo `~/.netflix-bot-start.sh`:

```bash
#!/bin/bash
cd /path/to/netflix-code-bot
pnpm start
```

### Opción 2: LaunchAgent (recomendado)

> ⚠️ **Importante**: Antes de usar LaunchAgent, ejecuta `pnpm start` manualmente
> al menos una vez para escanear el código QR de WhatsApp.

1. El proyecto incluye `start.sh` que se usa como punto de entrada.

2. Crea `~/Library/LaunchAgents/com.netflix-code-bot.plist`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.netflix-code-bot</string>
       <key>ProgramArguments</key>
       <array>
           <string>/Users/bryanvargas/.nvm/versions/node/v24.12.0/bin/node</string>
           <string>src/index.js</string>
       </array>
       <key>WorkingDirectory</key>
       <string>/Users/bryanvargas/Developer/netflix-code-bot</string>
       <key>EnvironmentVariables</key>
       <dict>
           <key>PATH</key>
           <string>/Users/bryanvargas/.nvm/versions/node/v24.12.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
       </dict>
       <key>RunAtLoad</key>
       <true/>
       <key>KeepAlive</key>
       <true/>
       <key>StandardOutPath</key>
       <string>/Users/bryanvargas/Developer/netflix-code-bot/data/bot.log</string>
       <key>StandardErrorPath</key>
       <string>/Users/bryanvargas/Developer/netflix-code-bot/data/bot-error.log</string>
   </dict>
   </plist>
   ```

3. Carga el servicio:

   ```bash
   launchctl load ~/Library/LaunchAgents/com.netflix-code-bot.plist
   ```

4. Verificar estado:

   ```bash
   launchctl list | grep netflix
   # Debería mostrar un PID (número) si está corriendo
   ```

5. Ver logs:

   ```bash
   tail -f data/bot.log
   tail -f data/bot-error.log
   ```

6. Detener/Reiniciar:

   ```bash
   # Detener
   launchctl unload ~/Library/LaunchAgents/com.netflix-code-bot.plist

   # Reiniciar
   launchctl unload ~/Library/LaunchAgents/com.netflix-code-bot.plist
   launchctl load ~/Library/LaunchAgents/com.netflix-code-bot.plist
   ```

## 📁 Estructura del Proyecto

```text
netflix-code-bot/
├── src/
│   ├── index.js              # Bot principal
│   ├── dashboard.js          # Dashboard web (WebSocket cliente)
│   └── services/
│       ├── gmail.js          # IMAP con imapflow
│       ├── whatsapp.js       # WhatsApp con Baileys
│       ├── browser.js        # Puppeteer para clics automáticos
│       ├── botStatus.js      # WebSocket server (puerto 3001)
│       └── database.js       # SQLite
├── dashboard/
│   └── public/
│       └── index.html        # UI del dashboard
├── data/                     # Datos (creado automáticamente)
│   ├── whatsapp-auth/        # Sesión de WhatsApp
│   └── netflix-bot.db        # Base de datos SQLite
├── contacts.json             # Mapeo de perfiles a números
├── .env                      # Variables de entorno
└── package.json
```

## ⚠️ Notas Importantes

1. **WhatsApp**: Este bot usa Baileys (no oficial). Evita spam para no ser
   bloqueado.

2. **Gmail**: Usa una Contraseña de Aplicación, no tu contraseña normal.
   sitio web: <https://myaccount.google.com/apppasswords>

3. **Seguridad**: No compartas `.env` ni `data/whatsapp-auth/`.

4. **Admin**: Configura `ADMIN_PHONE` para recibir alertas cuando falla la
   aprobación automática.

## 🐛 Solución de Problemas

### "Error de IMAP: Invalid credentials"

- Verifica que la Contraseña de Aplicación sea correcta
- Asegúrate de tener verificación en 2 pasos en Gmail

### "WhatsApp desconectado"

- Elimina `data/whatsapp-auth/` y escanea el QR nuevamente

### "Perfil no configurado"

- Agrega el perfil exactamente como aparece en el correo de Netflix

### "EADDRINUSE: address already in use"

```bash
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
```

## 📝 Licencia

MIT - Hecho con ❤️ para automatizar tu vida
