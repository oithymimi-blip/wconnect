import { useState, type FormEvent } from 'react'
import { withApiBase } from '../lib/apiBase'
import { postJson } from '../utils/api'

type TelemetrySignupProps = {
  variant?: 'hero' | 'full'
}

const HERO_METRICS = [
  { label: 'Latency', value: '2.1s avg', gradient: 'from-sky-400 to-cyan-500' },
  { label: 'Signal reach', value: '5,438 nodes', gradient: 'from-fuchsia-400 to-emerald-400' },
]

export function TelemetrySignup({ variant = 'full' }: TelemetrySignupProps) {
  const isHero = variant === 'hero'
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) {
      setStatus('error')
      setMessage('Enter an email to subscribe.')
      return
    }

    setStatus('loading')
    setMessage(null)

    try {
      const data = await postJson(
        [withApiBase('/api/subscribers'), '/api/subscribers'],
        { email: trimmed },
        { credentials: 'same-origin' },
      )

      setStatus('success')
      setMessage(
        data?.status === 'exists'
          ? 'You are already subscribed.'
          : 'Subscribed! Telemetry drops coming your way.'
      )
      setEmail('')
    } catch (error: any) {
      setStatus('error')
      setMessage(error?.message ?? 'Subscription failed. Try again shortly.')
    }
  }

  return (
    <div
      className={`relative overflow-hidden rounded-[32px] border border-white/12 bg-white/[0.04] px-6 py-6 text-sm shadow-[0_26px_96px_rgba(6,12,36,0.5)] ${
        isHero ? '' : 'sm:px-8 sm:py-7'
      }`}
    >
      <div className="pointer-events-none absolute inset-0 rounded-[32px] border border-white/10" />
      <div className="pointer-events-none absolute -left-20 top-[-25%] h-48 w-48 rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.25),transparent_70%)] blur-3xl" />
      <div className="pointer-events-none absolute right-[-15%] bottom-[-30%] h-52 w-52 rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.25),transparent_70%)] blur-3xl" />

      <div className={`relative flex flex-col ${isHero ? 'gap-6 lg:flex-row lg:items-center lg:justify-between' : 'gap-8 lg:flex-row lg:items-start lg:justify-between'}`}>
        <div className={`flex-1 space-y-4 ${isHero ? 'max-w-xl' : 'max-w-lg'}`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.32em] text-emerald-200">
              Telemetry drops
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.8)]" />
            </span>
            <span className="text-[10px] uppercase tracking-[0.32em] text-white/40">Weekly insights · multi-chain</span>
          </div>
          <h3 className={`font-semibold text-white ${isHero ? 'text-2xl' : 'text-3xl'}`}>
            Subscribe for instant market telemetry and automation playbooks.
          </h3>
          <p className="text-sm leading-relaxed text-white/65">
            Get curated signal bursts covering liquidity drifts, bridge unlocks, staking boosts, and response guides built for
            DeFi operations teams.
          </p>
          {!isHero && (
            <div className="grid gap-3 sm:grid-cols-2">
              {HERO_METRICS.map((metric) => (
                <div key={metric.label} className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.32em] text-white/45">{metric.label}</div>
                  <div className="mt-2 text-xl font-semibold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.16)]">
                    {metric.value}
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <span className={`block h-full w-4/5 rounded-full bg-gradient-to-r ${metric.gradient}`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className={`relative flex flex-col gap-4 rounded-[24px] border border-white/15 bg-black/70 px-5 py-5 shadow-[0_20px_70px_rgba(15,185,255,0.22)] ${
            isHero ? 'w-full max-w-md lg:w-[320px]' : 'w-full max-w-md'
          }`}
        >
          <div className="flex flex-col gap-2">
            <label className="text-[11px] uppercase tracking-[0.3em] text-white/50" htmlFor={`telemetry-email-${variant}`}>
              Signal inbox
            </label>
            <input
              id={`telemetry-email-${variant}`}
              type="email"
              required
              placeholder="you@defiops.xyz"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-white/20 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 focus:border-emerald-300 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-500 px-6 py-3 text-sm font-semibold text-black shadow-[0_18px_60px_rgba(56,189,248,0.38)] transition hover:shadow-[0_24px_80px_rgba(16,185,129,0.45)] disabled:opacity-60"
          >
            {status === 'loading' ? 'Joining…' : 'Join signal stream'}
          </button>
          {message && (
            <div
              aria-live="polite"
              className={`rounded-2xl border px-4 py-3 text-xs sm:text-sm ${
                status === 'success'
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100'
                  : 'border-rose-400/40 bg-rose-500/15 text-rose-200'
              }`}
            >
              {message}
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-white/45">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-white/5 text-[10px] font-semibold text-white/70">
              AES
            </span>
            <span className="text-[11px] uppercase tracking-[0.28em] text-white/50">
              Encrypted delivery · opt-out anytime
            </span>
          </div>
        </form>
      </div>

      {isHero && (
        <div className="relative mt-6 grid gap-3 sm:grid-cols-2">
          {HERO_METRICS.map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.32em] text-white/45">{metric.label}</div>
              <div className="mt-2 text-lg font-semibold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.16)]">
                {metric.value}
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <span className={`block h-full w-4/5 rounded-full bg-gradient-to-r ${metric.gradient}`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
