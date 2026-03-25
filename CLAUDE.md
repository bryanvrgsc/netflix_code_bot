# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # Install dependencies
pnpm start            # Start the bot (main process)
pnpm run dashboard    # Start the web dashboard (separate process)
pnpm run dev          # Start bot with --watch (auto-restart on file changes)
```

There are no tests in this project.

To restart the bot after code changes in dev mode, just save a file — `--watch` handles it.

## Architecture

Two independent Node.js processes communicate over a local WebSocket:

```
Bot (src/index.js)  ──ws://localhost:3001──►  Dashboard (src/dashboard.js)
Port: 3001 (WS only)                          Port: 3000 (HTTP + WS)
```

**Bot process** (`pnpm start`):
- Connects to Gmail via IMAP IDLE (imapflow) — event-driven, no polling
- Connects to WhatsApp via Baileys (unofficial WA Web API)
- On Netflix email: extracts code or Hogar approval URL, sends WhatsApp message
- Exposes WebSocket server on port 3001 to broadcast status/logs to dashboard
- Runs a 5-minute watchdog that reconnects services if disconnected

**Dashboard process** (`pnpm run dashboard`):
- Express server + WebSocket server for browser clients on port 3000
- Acts as WebSocket *client* to the bot on port 3001, relaying messages to browser
- Exposes REST API: `GET /api/logs`, `GET /api/stats`, `GET /api/contacts`, `POST /api/contacts`
- Serves static HTML from `dashboard/public/index.html`

### Service layer (`src/services/`)

| File | Responsibility |
|------|---------------|
| `gmail.js` | IMAP IDLE connection, email parsing, exponential backoff reconnect (30s→5min), 4-min NOOP heartbeat |
| `whatsapp.js` | Baileys socket, QR display on first run, auto-reconnect, sends text/image messages |
| `browser.js` | Puppeteer (headless Chrome) to auto-click Netflix Hogar approval links |
| `database.js` | better-sqlite3, `logs` and `stats` tables, dedup check (same code within 1 hour) |
| `botStatus.js` | WebSocket server on port 3001, broadcasts `status`/`newLog`/`processing` events |

### Key data flows

**Netflix verification code email:**
1. IMAP IDLE triggers `exists` event → `checkForNetflixEmails()`
2. `extractNetflixData()` regex-parses subject+body for code and profile name
3. Bot emits `netflixCode` → `index.js` looks up profile in `contacts.json`
4. `whatsapp.sendNetflixCode()` sends formatted message
5. `logCodeSent()` writes to SQLite; WebSocket notifies dashboard

**Netflix Hogar request email:**
1. Same IMAP flow, emits `netflixHogar`
2. `browser.approveNetflixHogar()` opens approval URL in headless Chrome, clicks confirm button
3. If success → WhatsApp notification to user; if failure → screenshot sent to `ADMIN_PHONE`

### Persistent state

- `data/whatsapp-auth/` — Baileys multi-file auth (persists WhatsApp session across restarts)
- `data/netflix-bot.db` — SQLite database (logs + daily stats)
- `contacts.json` — Netflix profile name → phone number mapping (editable via dashboard API)

## Configuration

Copy `.env.example` to `.env`. Required variables:

```
GMAIL_USER=         # Gmail address receiving Netflix emails
GMAIL_APP_PASSWORD= # App-specific password (not account password)
ADMIN_PHONE=        # WhatsApp number for error alerts (country code, no + or spaces)
DASHBOARD_PORT=3000 # Optional, defaults to 3000
```

Phone numbers in `contacts.json` must include country code without `+` (e.g., `521234567890` for Mexico).

## Important notes

- **WhatsApp session**: First run requires QR scan. Session persists in `data/whatsapp-auth/`. Delete this directory to force re-authentication.
- **Baileys**: Unofficial WhatsApp Web API. The bot identifies itself as `Mac OS / Safari 10.15.7` to avoid detection.
- **BrowserService**: Uses `puppeteer-core` with system Chrome — it searches common install paths. Chrome must be installed separately.
- **Port conflicts**: If `EADDRINUSE`, kill with `lsof -ti:3001 | xargs kill -9`.
- **Duplicate prevention**: `isCodeProcessed()` in `database.js` blocks re-processing the same code or any `HOGAR_*` event within a 1-hour window.
- **ESM**: The project uses `"type": "module"` — all imports use `.js` extensions and `import`/`export` syntax.
