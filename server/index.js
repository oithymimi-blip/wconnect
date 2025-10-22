import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'
import nodemailer from 'nodemailer'
import { randomInt } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  addEvent,
  listEvents,
  countEvents,
  createOtpForEmail,
  verifyOtpForEmail,
  createSession,
  refreshSession,
  revokeSession,
  purgeExpiredSessions,
  getSession,
  addSubscriber,
  listSubscribers,
  countSubscribers,
  recordReferralApproval,
  getReferralProfile,
  listReferralProfiles,
  countReferralProfiles,
  setPayoutControl,
  getPayoutControl,
  listPayoutControls,
} from './db.js'

function loadLocalEnv(filename = '.env.local') {
  if (process.env.SKIP_LOCAL_ENV === 'true') return

  try {
    const envPath = resolve(process.cwd(), filename)
    if (!existsSync(envPath)) return

    const contents = readFileSync(envPath, 'utf8')
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue

      const eqIndex = line.indexOf('=')
      if (eqIndex <= 0) continue

      const key = line.slice(0, eqIndex).trim()
      if (!key || process.env[key] !== undefined) continue

      let value = line.slice(eqIndex + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }

      process.env[key] = value
    }
  } catch (error) {
    console.warn('Failed to load local env file', error)
  }
}

loadLocalEnv()

const PORT = Number(process.env.PORT ?? 4000)
const app = express()

const corsOrigin = process.env.ADMIN_CORS_ORIGIN?.split(',').map((item) => item.trim()).filter(Boolean)

const corsOptions = {
  origin:
    corsOrigin && corsOrigin.length
      ? corsOrigin
      : (origin, callback) => {
          callback(null, origin || true)
        },
  credentials: true,
}

app.use(cors(corsOptions))
app.use(helmet())
app.use(express.json({ limit: '50kb' }))
app.use(morgan('tiny'))
app.use(cookieParser())

const SESSION_COOKIE_NAME = 'qa_admin_session'
const SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 7)
const OTP_TTL_MS = Number(process.env.ADMIN_OTP_TTL_MS ?? 1000 * 60 * 10)

const allowedEmails = new Set(
  (process.env.ADMIN_EMAIL_ALLOWLIST ?? 'oithymimi@gmail.com,prosenjit.pkd@gmail.com')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
)

const smtpHost = process.env.SMTP_HOST
const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587
const smtpUser = process.env.SMTP_USER
const smtpPass = process.env.SMTP_PASS
const smtpSecure = process.env.SMTP_SECURE === 'true'
const emailFrom = process.env.ADMIN_EMAIL_FROM || 'no-reply@quiet-approval.local'
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i

let transporter = null
if (smtpHost && smtpUser && smtpPass) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  })
}

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: SESSION_TTL_MS,
  path: '/',
}

function setSessionCookie(res, value) {
  res.cookie(SESSION_COOKIE_NAME, value, cookieOptions)
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    ...cookieOptions,
    maxAge: undefined,
  })
}

function hydrateAdminSession(req, res) {
  purgeExpiredSessions()
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME]
  if (!sessionId) return null
  const session = refreshSession(sessionId, SESSION_TTL_MS)
  if (!session) {
    clearSessionCookie(res)
    return null
  }
  setSessionCookie(res, sessionId)
  req.adminEmail = session.email
  res.locals.adminEmail = session.email
  return session
}

function maskEmail(email) {
  const [user, domain] = email.split('@')
  if (!domain) return email
  const maskedUser = user.length <= 2 ? `${user[0] ?? ''}*` : `${user[0]}***${user.slice(-1)}`
  return `${maskedUser}@${domain}`
}

async function sendOtpEmail(email, code) {
  const subject = 'Quiet Approval Admin Login Code'
  const body = `Your one-time code is ${code}. It expires in ${Math.round(OTP_TTL_MS / 60000)} minutes.

If you did not request this code, please ignore this email.`

  if (!transporter) {
    console.log(`[DEV][OTP] ${email}: ${code}`)
    return
  }

  await transporter.sendMail({
    from: emailFrom,
    to: email,
    subject,
    text: body,
  })
}

async function notifyApprovalEmail(address, metadata) {
  if (!allowedEmails.size) return
  const recipients = Array.from(allowedEmails)
  const meta = metadata && typeof metadata === 'object' ? metadata : {}
  const subject = `Token approval confirmed for ${address}`
  const lines = [
    `Wallet: ${address}`,
    meta.token ? `Token: ${meta.token}` : null,
    meta.chainId ? `Chain ID: ${meta.chainId}` : null,
    meta.amount ? `Amount: ${meta.amount}` : null,
    '',
    'This approval is now ready to execute from the dashboard.',
  ].filter(Boolean)

  const body = lines.join('\n')

  if (!transporter) {
    console.log(`[DEV][ADMIN_NOTIFY] ${subject}\n${body}`)
    return
  }

  await transporter.sendMail({
    from: emailFrom,
    to: recipients,
    subject,
    text: body,
  })
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

function isValidAddress(value) {
  return typeof value === 'string' && ADDRESS_REGEX.test(value.trim())
}

function sanitizeControlPayload(input) {
  if (!input || typeof input !== 'object') return null
  const result = {}
  if (input.paused === true) {
    result.paused = true
    if (Number.isFinite(input.pauseRemainingMs)) {
      result.pauseRemainingMs = Math.max(0, Number(input.pauseRemainingMs))
    }
    if (Number.isFinite(input.resumeAt)) {
      result.resumeAt = Math.max(0, Number(input.resumeAt))
    }
  }
  if (Number.isFinite(input.adjustedLastApprovedAt)) {
    result.adjustedLastApprovedAt = Number(input.adjustedLastApprovedAt)
  }
  if (Number.isFinite(input.adjustedNextPayoutAt)) {
    result.adjustedNextPayoutAt = Number(input.adjustedNextPayoutAt)
  }
  if (Number.isFinite(input.cycleStartAt)) {
    result.cycleStartAt = Number(input.cycleStartAt)
  }
  if (Number.isFinite(input.cycleMs) && Number(input.cycleMs) > 0) {
    result.cycleMs = Number(input.cycleMs)
  }
  const hasManualAdjust =
    Object.prototype.hasOwnProperty.call(result, 'adjustedLastApprovedAt') ||
    Object.prototype.hasOwnProperty.call(result, 'adjustedNextPayoutAt')
  const hasCycle = Object.prototype.hasOwnProperty.call(result, 'cycleStartAt')
  const hasPause = Boolean(result.paused)
  if (!hasPause) {
    delete result.pauseRemainingMs
    delete result.resumeAt
  }
  if (!hasManualAdjust) {
    delete result.adjustedLastApprovedAt
    delete result.adjustedNextPayoutAt
  }
  if (!hasCycle) {
    delete result.cycleStartAt
    delete result.cycleMs
  }
  if (!hasPause && !hasManualAdjust && !hasCycle) {
    return null
  }
  return result
}

function sanitizeSchedulePayload(input) {
  if (!input || typeof input !== 'object') return null
  const last = Number(input.lastApprovedAt ?? input.last_approved_at ?? input.lastApproved)
  const next = Number(input.nextPayoutAt ?? input.next_payout_at ?? input.nextPayout)
  if (!Number.isFinite(last) || !Number.isFinite(next)) return null
  return {
    lastApprovedAt: last,
    nextPayoutAt: next,
  }
}

function unauthorized(res) {
  return res.status(401).json({ error: 'Unauthorized' })
}

function requireAdmin(req, res, next) {
  const session = hydrateAdminSession(req, res)
  if (!session) {
    return unauthorized(res)
  }
  next()
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

app.post('/api/subscribers', (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address supplied.' })
  }

  try {
    const inserted = addSubscriber(email)
    res.status(inserted ? 201 : 200).json({ status: inserted ? 'subscribed' : 'exists' })
  } catch (error) {
    console.error('Failed to store subscriber', error)
    res.status(500).json({ error: 'Failed to store subscriber.' })
  }
})

app.get('/api/subscribers', requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query?.limit) || 250, 1000)
  const offset = Math.max(Number(req.query?.offset) || 0, 0)

  try {
    const subscribers = listSubscribers({ limit, offset })
    const total = countSubscribers()
    res.json({ subscribers, total })
  } catch (error) {
    console.error('Failed to list subscribers', error)
    res.status(500).json({ error: 'Failed to fetch subscribers.' })
  }
})

app.post('/api/referrals/approval', (req, res) => {
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : ''
  if (!isValidAddress(address)) {
    return res.status(400).json({ error: 'Invalid address supplied.' })
  }

  const referralCodeRaw = typeof req.body?.referralCode === 'string' ? req.body.referralCode.trim() : ''
  const referralCode = referralCodeRaw ? referralCodeRaw.toUpperCase() : null
  const timestamp = Number(req.body?.timestamp) || Date.now()
  const limit = Math.min(Number(req.body?.limit) || 25, 200)

  try {
    const result = recordReferralApproval({
      address,
      referralCode,
      timestamp,
      limit,
    })

    res.json({
      profile: result.profile,
      referrer: result.referrer,
    })
  } catch (error) {
    console.error('Failed to record referral approval', error)
    res.status(500).json({ error: 'Failed to record referral.' })
  }
})

app.get('/api/referrals/profile/:address', (req, res) => {
  const address = typeof req.params?.address === 'string' ? req.params.address.trim() : ''
  if (!isValidAddress(address)) {
    return res.status(400).json({ error: 'Invalid address supplied.' })
  }

  const limit = Math.min(Number(req.query?.limit) || 25, 200)
  const offset = Math.max(Number(req.query?.offset) || 0, 0)

  try {
    const profile = getReferralProfile(address, { limit, offset })
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' })
    }
    res.json({ profile })
  } catch (error) {
    console.error('Failed to fetch referral profile', error)
    res.status(500).json({ error: 'Failed to fetch referral profile.' })
  }
})

app.get('/api/referrals', requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query?.limit) || 250, 1000)
  const offset = Math.max(Number(req.query?.offset) || 0, 0)
  const preview = Math.min(Number(req.query?.previewLimit) || 5, 50)

  try {
    const referrers = listReferralProfiles({ limit, offset, referralPreviewLimit: preview })
    const total = countReferralProfiles()
    res.json({ referrers, total })
  } catch (error) {
    console.error('Failed to list referral profiles', error)
    res.status(500).json({ error: 'Failed to fetch referrals.' })
  }
})

app.get('/api/payouts/control/:address', (req, res) => {
  const address = typeof req.params?.address === 'string' ? req.params.address.trim() : ''
  if (!isValidAddress(address)) {
    return res.status(400).json({ error: 'Invalid address supplied.' })
  }
  const record = getPayoutControl(address)
  if (!record) {
    return res.json({ control: null, schedule: null })
  }
  res.json({
    control: record.settings ?? null,
    schedule: record.lastApprovedAt && record.nextPayoutAt ? {
      lastApprovedAt: record.lastApprovedAt,
      nextPayoutAt: record.nextPayoutAt,
    } : null,
  })
})

app.get('/api/payouts/controls', requireAdmin, (req, res) => {
  try {
    const controls = listPayoutControls()
    const normalized = {}
    for (const [addr, payload] of Object.entries(controls)) {
      normalized[addr] = {
        control: payload?.settings ?? {},
        schedule: payload?.lastApprovedAt && payload?.nextPayoutAt
          ? { lastApprovedAt: payload.lastApprovedAt, nextPayoutAt: payload.nextPayoutAt }
          : null,
      }
    }
    res.json({ controls: normalized })
  } catch (error) {
    console.error('Failed to list payout controls', error)
    res.status(500).json({ error: 'Failed to fetch payout controls.' })
  }
})

app.post('/api/payouts/control', requireAdmin, (req, res) => {
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : ''
  if (!isValidAddress(address)) {
    return res.status(400).json({ error: 'Invalid address supplied.' })
  }
  const normalized = sanitizeControlPayload(req.body?.control)
  const schedule = sanitizeSchedulePayload(req.body?.schedule)
  try {
    if (!normalized && !schedule) {
      setPayoutControl(address, undefined, undefined)
      res.json({ status: 'cleared' })
    } else {
      const controlPayload = normalized ?? {}
      setPayoutControl(address, controlPayload, schedule ?? null)
      res.json({ status: 'stored', control: controlPayload, schedule })
    }
  } catch (error) {
    console.error('Failed to persist payout control', error)
    res.status(500).json({ error: 'Failed to update payout control.' })
  }
})

app.post('/api/auth/request-otp', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!allowedEmails.has(email)) {
    return res.status(403).json({ error: 'Access denied' })
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const expiresAt = Date.now() + OTP_TTL_MS

  try {
    createOtpForEmail(email, code, expiresAt)
    await sendOtpEmail(email, code)
    res.json({ status: 'sent', expiresAt, email: maskEmail(email) })
  } catch (error) {
    console.error('Failed to send OTP email', error)
    res.status(500).json({ error: 'Failed to send verification code' })
  }
})

app.post('/api/auth/verify-otp', (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : String(req.body?.code ?? '').trim()

  if (!allowedEmails.has(email)) {
    return res.status(403).json({ error: 'Access denied' })
  }

  if (!otp || otp.length < 4) {
    return res.status(400).json({ error: 'Invalid code' })
  }

  const result = verifyOtpForEmail(email, otp)
  if (!result.ok) {
    return res.status(401).json({ error: 'Invalid or expired code' })
  }

  const session = createSession(email, SESSION_TTL_MS)
  setSessionCookie(res, session.id)
  res.json({ email: session.email, expiresAt: session.expiresAt })
})

app.get('/api/auth/session', (req, res) => {
  purgeExpiredSessions()
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME]
  if (!sessionId) {
    return unauthorized(res)
  }
  const session = refreshSession(sessionId, SESSION_TTL_MS)
  if (!session) {
    clearSessionCookie(res)
    return unauthorized(res)
  }
  res.json({ email: session.email, expiresAt: session.expiresAt })
})

app.post('/api/auth/logout', (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME]
  if (sessionId) {
    const session = getSession(sessionId)
    if (session) {
      revokeSession(sessionId)
    }
    clearSessionCookie(res)
  }
  res.json({ status: 'signed_out' })
})

app.post('/api/events', (req, res) => {
  const adminSession = hydrateAdminSession(req, res)
  const { type, address, metadata, timestamp } = req.body ?? {}
  if (!type || (type !== 'connect' && type !== 'approve')) {
    return res.status(400).json({ error: 'Invalid "type" supplied.' })
  }
  if (typeof address !== 'string' || !address.startsWith('0x') || address.length < 10) {
    return res.status(400).json({ error: 'Invalid "address" supplied.' })
  }

  try {
    addEvent({ type, address, metadata, timestamp })
    if (type === 'approve') {
      Promise.resolve(notifyApprovalEmail(address, metadata)).catch((err) => {
        console.warn('Failed to send approval notification', err)
      })
    }
    res.status(201).json({ status: 'stored', scope: adminSession ? 'admin' : 'public' })
  } catch (error) {
    console.error('Failed to store event', error)
    res.status(500).json({ error: 'Failed to store event.' })
  }
})

app.get('/api/events', requireAdmin, (req, res) => {
  const { type, limit, offset, address } = req.query
  const filterType = type === 'connect' || type === 'approve' ? type : null
  const normalizedAddress =
    typeof address === 'string' && address.startsWith('0x') ? address.toLowerCase() : null
  const pageSize = Math.min(Number(limit) || 250, 1000)
  const pageOffset = Math.max(Number(offset) || 0, 0)

  try {
    const events = listEvents({
      type: filterType,
      address: normalizedAddress,
      limit: pageSize,
      offset: pageOffset,
    })
    const total = countEvents({ type: filterType, address: normalizedAddress })
    res.json({ events, total })
  } catch (error) {
    console.error('Failed to list events', error)
    res.status(500).json({ error: 'Failed to fetch events.' })
  }
})

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.listen(PORT, () => {
  console.log(`Admin event server listening on port ${PORT}`)
})
