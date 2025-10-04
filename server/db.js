import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

const DATA_DIR = path.resolve(process.cwd(), 'data')
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const DB_PATH = path.join(DATA_DIR, 'admin-events.db')
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    address TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(type, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_events_address ON events(address);

  CREATE TABLE IF NOT EXISTS otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_otps_email ON otp_codes(email);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_subscribers_created ON subscribers(created_at DESC);
`)

const insertStmt = db.prepare(
  `INSERT INTO events (type, address, metadata, created_at) VALUES (@type, @address, @metadata, @created_at)`
)
const lastEventStmt = db.prepare(
  `SELECT id, created_at FROM events WHERE type = ? AND address = ? ORDER BY created_at DESC, id DESC LIMIT 1`
)
const listStmt = db.prepare(
  `SELECT id, type, address, metadata, created_at FROM events
   WHERE (@type IS NULL OR type = @type)
     AND (@address IS NULL OR address = @address)
   ORDER BY created_at DESC, id DESC
   LIMIT @limit OFFSET @offset`
)
const countStmt = db.prepare(
  `SELECT COUNT(*) as total FROM events
   WHERE (@type IS NULL OR type = @type)
     AND (@address IS NULL OR address = @address)`
)

const insertOtpStmt = db.prepare(
  `INSERT INTO otp_codes (email, code_hash, salt, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
)
const purgeOtpsStmt = db.prepare(`DELETE FROM otp_codes WHERE expires_at < ? OR used_at IS NOT NULL AND used_at < (? - 86_400_000)`)
const deleteOtpByEmailStmt = db.prepare(`DELETE FROM otp_codes WHERE email = ?`)
const deleteOtpByIdStmt = db.prepare(`DELETE FROM otp_codes WHERE id = ?`)
const getOtpStmt = db.prepare(
  `SELECT id, code_hash, salt, expires_at, attempts, used_at FROM otp_codes
   WHERE email = ?
   ORDER BY created_at DESC
   LIMIT 1`
)
const incrementOtpAttemptsStmt = db.prepare(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`)
const markOtpUsedStmt = db.prepare(`UPDATE otp_codes SET used_at = ? WHERE id = ?`)

const insertSessionStmt = db.prepare(
  `INSERT INTO sessions (id, email, created_at, last_seen, expires_at, revoked)
   VALUES (?, ?, ?, ?, ?, 0)`
)
const getSessionStmt = db.prepare(
  `SELECT id, email, created_at, last_seen, expires_at, revoked FROM sessions WHERE id = ?`
)
const touchSessionStmt = db.prepare(
  `UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?`
)
const revokeSessionStmt = db.prepare(
  `UPDATE sessions SET revoked = 1, expires_at = ?, last_seen = ? WHERE id = ?`
)
const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`)
const purgeSessionsStmt = db.prepare(`DELETE FROM sessions WHERE expires_at < ? OR (revoked = 1 AND expires_at < ?)`)

const insertSubscriberStmt = db.prepare(
  `INSERT INTO subscribers (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING`
)
const listSubscribersStmt = db.prepare(
  `SELECT id, email, created_at FROM subscribers ORDER BY created_at DESC LIMIT @limit OFFSET @offset`
)
const countSubscribersStmt = db.prepare(`SELECT COUNT(*) as total FROM subscribers`)

export function addEvent({ type, address, metadata, timestamp }) {
  const created_at = typeof timestamp === 'number' ? timestamp : Date.now()
  const normalizedAddress = address.toLowerCase()

  if (type === 'connect') {
    const existing = lastEventStmt.get(type, normalizedAddress)
    if (existing) {
      return
    }
  }
  insertStmt.run({
    type,
    address: normalizedAddress,
    metadata: metadata ? JSON.stringify(metadata) : null,
    created_at,
  })
}

export function listEvents({ type = null, address = null, limit = 250, offset = 0 } = {}) {
  const rows = listStmt.all({ type, address, limit, offset })
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    address: row.address,
    timestamp: row.created_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }))
}

export function countEvents({ type = null, address = null } = {}) {
  const row = countStmt.get({ type, address })
  return row?.total ?? 0
}

export function addSubscriber(email, createdAt = Date.now()) {
  const result = insertSubscriberStmt.run(email.toLowerCase(), createdAt)
  return result.changes > 0
}

export function listSubscribers({ limit = 250, offset = 0 } = {}) {
  const rows = listSubscribersStmt.all({ limit, offset })
  return rows.map((row) => ({ id: row.id, email: row.email, createdAt: row.created_at }))
}

export function countSubscribers() {
  const row = countSubscribersStmt.get()
  return row?.total ?? 0
}

export function close() {
  db.close()
}

function hashOtp(code, salt) {
  return crypto.createHash('sha256').update(`${code}:${salt}`).digest('hex')
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export function purgeExpiredOtps(now = Date.now()) {
  purgeOtpsStmt.run(now, now)
}

export function createOtpForEmail(email, code, expiresAt) {
  const now = Date.now()
  purgeExpiredOtps(now)
  deleteOtpByEmailStmt.run(email)
  const salt = crypto.randomBytes(16).toString('hex')
  const codeHash = hashOtp(String(code), salt)
  insertOtpStmt.run(email, codeHash, salt, expiresAt, now)
}

export function verifyOtpForEmail(email, code) {
  const now = Date.now()
  purgeExpiredOtps(now)
  const row = getOtpStmt.get(email)
  if (!row) {
    return { ok: false, reason: 'missing' }
  }
  if (row.used_at) {
    deleteOtpByIdStmt.run(row.id)
    return { ok: false, reason: 'used' }
  }
  if (row.expires_at < now) {
    deleteOtpByIdStmt.run(row.id)
    return { ok: false, reason: 'expired' }
  }
  const attemptedHash = hashOtp(String(code).trim(), row.salt)
  const matches = safeEqual(row.code_hash, attemptedHash)
  if (!matches) {
    incrementOtpAttemptsStmt.run(row.id)
    if ((row.attempts ?? 0) + 1 >= 5) {
      deleteOtpByIdStmt.run(row.id)
    }
    return { ok: false, reason: 'mismatch' }
  }
  markOtpUsedStmt.run(now, row.id)
  deleteOtpByEmailStmt.run(email)
  return { ok: true }
}

export function purgeExpiredSessions(now = Date.now()) {
  purgeSessionsStmt.run(now, now)
}

export function createSession(email, ttlMs) {
  const now = Date.now()
  purgeExpiredSessions(now)
  const id = crypto.randomBytes(32).toString('hex')
  const expiresAt = now + ttlMs
  insertSessionStmt.run(id, email, now, now, expiresAt)
  return { id, email, createdAt: now, expiresAt }
}

export function getSession(sessionId) {
  if (!sessionId) return null
  const row = getSessionStmt.get(sessionId)
  if (!row) return null
  const now = Date.now()
  if (row.revoked || row.expires_at < now) {
    deleteSessionStmt.run(sessionId)
    return null
  }
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
    expiresAt: row.expires_at,
  }
}

export function refreshSession(sessionId, ttlMs) {
  const now = Date.now()
  const row = getSession(sessionId)
  if (!row) return null
  const newExpiry = now + ttlMs
  touchSessionStmt.run(now, newExpiry, sessionId)
  return { ...row, lastSeen: now, expiresAt: newExpiry }
}

export function revokeSession(sessionId) {
  const now = Date.now()
  revokeSessionStmt.run(now, sessionId)
}
