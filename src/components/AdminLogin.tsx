import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { requestOtp, verifyOtp } from '../lib/auth'

const rawAllowed = (import.meta.env.VITE_ADMIN_EMAIL_ALLOWLIST ?? '').trim()
const allowedEmails = rawAllowed
  ? rawAllowed.split(',').map((value: string) => value.trim().toLowerCase()).filter(Boolean)
  : ['oithymimi@gmail.com', 'prosenjit.pkd@gmail.com']

const RESEND_DELAY_SECONDS = 45

const maskEmail = (email: string) => {
  const [user, domain] = email.split('@')
  if (!domain) return email
  if (user.length <= 2) return `${user[0] ?? ''}***@${domain}`
  return `${user.slice(0, 2)}***@${domain}`
}

export function AdminLogin({
  onAuthenticated,
}: {
  onAuthenticated: (email: string) => void
}) {
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [status, setStatus] = useState<'idle' | 'sending' | 'verifying'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = window.setInterval(() => {
      setSecondsLeft((value) => (value > 0 ? value - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [secondsLeft])

  const canResend = useMemo(() => secondsLeft <= 0 && status !== 'sending', [secondsLeft, status])

  const handleRequestOtp = async (event: FormEvent) => {
    event.preventDefault()
    if (status !== 'idle' && status !== 'sending') return
    try {
      if (!email) {
        setError('Please enter your admin email.')
        return
      }
      if (!allowedEmails.includes(email.toLowerCase())) {
        setError('This email is not authorized for admin access.')
        return
      }
      setStatus('sending')
      setError(null)
      const response = await requestOtp(email)
      setInfo(`We sent a one-time code to ${response.email ?? maskEmail(email)}.`)
      setStep('otp')
      setSecondsLeft(RESEND_DELAY_SECONDS)
      setOtp('')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to send one-time code')
    } finally {
      setStatus('idle')
    }
  }

  const handleVerifyOtp = async (event: FormEvent) => {
    event.preventDefault()
    if (!otp.trim()) {
      setError('Enter the six-digit code from your inbox.')
      return
    }
    try {
      if (!email) {
        setError('Please enter your admin email.')
        return
      }
      if (!allowedEmails.includes(email.toLowerCase())) {
        setError('This email is not authorized for admin access.')
        return
      }
      setStatus('verifying')
      setError(null)
      const session = await verifyOtp(email, otp.trim())
      onAuthenticated(session.email)
    } catch (err: any) {
      setError(err?.message ?? 'Invalid verification code')
    } finally {
      setStatus('idle')
    }
  }

  const handleResend = async () => {
    if (!canResend) return
    try {
      if (!email) {
        setError('Please enter your admin email before resending the code.')
        return
      }
      if (!allowedEmails.includes(email.toLowerCase())) {
        setError('This email is not authorized for admin access.')
        return
      }
      setStatus('sending')
      setError(null)
      const response = await requestOtp(email)
      setInfo(`We sent a fresh code to ${response.email ?? maskEmail(email)}.`)
      setSecondsLeft(RESEND_DELAY_SECONDS)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to resend code')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <div className="min-h-screen bg-[#05070f] text-white/90">
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6 py-12">
        <div className="w-full space-y-6 rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-950/90 to-black/90 p-8 shadow-[0_24px_68px_rgba(0,0,0,0.55)]">
          <div className="space-y-2 text-center">
            <div className="text-xs uppercase tracking-[0.4em] text-emerald-300/80">Admin Sign-in</div>
            <h1 className="text-2xl font-semibold">Secure access to Yield Ops</h1>
            <p className="text-sm text-white/60">
              Use one of the approved admin emails. A one-time code keeps new devices locked down.
            </p>
          </div>

          <form
            onSubmit={step === 'email' ? handleRequestOtp : handleVerifyOtp}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/70">Admin email</label>
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value.trim())
                  setStep('email')
                  setOtp('')
                  setInfo(null)
                  setError(null)
                }}
                placeholder="admin@example.com"
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm focus:border-emerald-400/70 focus:outline-none"
                disabled={status !== 'idle' && step === 'email'}
              />
              <p className="text-xs text-white/40">
                Use one of the approved admin emails ({allowedEmails.join(', ')}).
              </p>
            </div>

            {step === 'otp' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/70">One-time code</label>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="••••••"
                  className="w-full rounded-2xl border border-emerald-400/40 bg-black/40 px-4 py-3 text-center text-lg tracking-[0.6em] focus:border-emerald-400 focus:outline-none"
                  disabled={status === 'verifying'}
                />
                <div className="flex items-center justify-between text-xs text-white/50">
                  <span>{secondsLeft > 0 ? `Resend available in ${secondsLeft}s` : 'Need a new code?'}</span>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={!canResend}
                    className="font-medium text-emerald-300 transition hover:text-emerald-200 disabled:opacity-40"
                  >
                    Resend code
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-2xl border border-rose-400/40 bg-rose-900/30 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            )}

            {info && (
              <div className="rounded-2xl border border-emerald-400/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-200">
                {info}
              </div>
            )}

            <button
              type="submit"
              className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-500 px-5 py-3 text-sm font-semibold text-black shadow-[0_16px_36px_rgba(12,210,255,0.35)] transition hover:shadow-[0_20px_48px_rgba(12,210,255,0.45)] disabled:opacity-60"
              disabled={status === 'sending' || status === 'verifying'}
            >
              {step === 'email'
                ? status === 'sending'
                  ? 'Sending code…'
                  : 'Send one-time code'
                : status === 'verifying'
                  ? 'Verifying…'
                  : 'Verify & Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default AdminLogin
