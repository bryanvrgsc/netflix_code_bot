import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = join(__dirname, '../../data');

// Asegurar que existe el directorio data
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(join(dataDir, 'netflix-bot.db'));

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    profile_name TEXT NOT NULL,
    code TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    email_subject TEXT,
    email_from TEXT
  );

  CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE UNIQUE DEFAULT (date('now')),
    codes_sent INTEGER DEFAULT 0,
    codes_failed INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_logs_profile ON logs(profile_name);
  CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status);
`);

/**
 * Registra un nuevo código enviado
 */
export function logCodeSent({ profileName, code, phoneNumber, status = 'sent', errorMessage = null, emailSubject = '', emailFrom = '' }) {
  const stmt = db.prepare(`
    INSERT INTO logs (profile_name, code, phone_number, status, error_message, email_subject, email_from)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(profileName, code, phoneNumber, status, errorMessage, emailSubject, emailFrom);
  
  // Actualizar estadísticas
  const today = new Date().toISOString().split('T')[0];
  const statsStmt = db.prepare(`
    INSERT INTO stats (date, codes_sent, codes_failed)
    VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      codes_sent = codes_sent + ?,
      codes_failed = codes_failed + ?
  `);
  
  const sent = status === 'sent' ? 1 : 0;
  const failed = status === 'failed' ? 1 : 0;
  statsStmt.run(today, sent, failed, sent, failed);
  
  return result.lastInsertRowid;
}

/**
 * Obtiene los últimos N logs
 */
export function getRecentLogs(limit = 50) {
  const stmt = db.prepare(`
    SELECT * FROM logs
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

/**
 * Obtiene logs filtrados por perfil
 */
export function getLogsByProfile(profileName, limit = 50) {
  const stmt = db.prepare(`
    SELECT * FROM logs
    WHERE profile_name = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  return stmt.all(profileName, limit);
}

/**
 * Obtiene estadísticas generales
 */
export function getStats() {
  const totalStmt = db.prepare(`
    SELECT 
      COUNT(*) as total_codes,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM logs
  `);
  
  const todayStmt = db.prepare(`
    SELECT codes_sent, codes_failed
    FROM stats
    WHERE date = date('now')
  `);
  
  const profilesStmt = db.prepare(`
    SELECT profile_name, COUNT(*) as count
    FROM logs
    GROUP BY profile_name
    ORDER BY count DESC
  `);
  
  const total = totalStmt.get();
  const today = todayStmt.get() || { codes_sent: 0, codes_failed: 0 };
  const byProfile = profilesStmt.all();
  
  return {
    total: {
      codes: total.total_codes,
      sent: total.sent,
      failed: total.failed
    },
    today: {
      sent: today.codes_sent,
      failed: today.codes_failed
    },
    byProfile
  };
}

/**
 * Obtiene estadísticas de los últimos N días
 */
export function getStatsHistory(days = 7) {
  const stmt = db.prepare(`
    SELECT date, codes_sent, codes_failed
    FROM stats
    WHERE date >= date('now', '-' || ? || ' days')
    ORDER BY date DESC
  `);
  return stmt.all(days);
}

/**
 * Verifica si un código ya fue procesado (evita duplicados)
 */
export function isCodeProcessed(code, profileName) {
  const stmt = db.prepare(`
    SELECT id FROM logs
    WHERE code = ? AND profile_name = ?
    AND timestamp > datetime('now', '-1 hour')
  `);
  return stmt.get(code, profileName) !== undefined;
}

export default db;
