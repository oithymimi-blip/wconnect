import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Address } from 'viem'
import { fetchWalletSnapshot, type WalletSnapshot } from '../lib/walletSummary'
import {
  fetchAdminEvents,
  fetchSubscribers,
  type AdminEventRecord,
  type AdminSubscriberRecord,
} from '../lib/adminApi'
import { AdminLogin } from '../components/AdminLogin'
import { fetchSession, logout as logoutSession } from '../lib/auth'

const REFRESH_MS = 25000
const DAY_MS = 24 * 60 * 60 * 1000

type Tab = 'connect' | 'approve' | 'big-balance' | 'subscribers'

const tabLabels: Record<Tab, string> = {
  connect: 'Connected',
  approve: 'Approved',
  'big-balance': 'Big Balance',
  subscribers: 'Subscribers',
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
  const [authState, setAuthState] = useState<'checking' | 'unauthenticated' | 'authenticated'>('checking')
  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())
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
  }, [])

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
    const id = setInterval(loadEvents, REFRESH_MS)
    return () => clearInterval(id)
  }, [isAuthorized, loadEvents])

  useEffect(() => {
    if (!isAuthorized) return
    loadSubscribers()
  }, [isAuthorized, loadSubscribers])

  useEffect(() => {
    if (!isAuthorized) return
    const id = setInterval(loadSubscribers, 60_000)
    return () => clearInterval(id)
  }, [isAuthorized, loadSubscribers])

  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!isAuthorized) return
    refreshSnapshots()
    if (!addressEntries.length) return
    const id = setInterval(refreshSnapshots, REFRESH_MS)
    return () => clearInterval(id)
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

  const upcomingPayouts = useMemo(() => {
    return payoutSummaries
      .map((summary) => {
        const remaining = summary.nextPayoutAt - nowTs
        const totalUsd = snapshots[summary.address.toLowerCase()]?.totalUsd
        return { ...summary, remaining, totalUsd }
      })
      .sort((a, b) => a.nextPayoutAt - b.nextPayoutAt)
  }, [nowTs, payoutSummaries, snapshots])

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
  const activeRows = isSubscriberView ? subscriberRows : eventRows
  const activeLoading = isSubscriberView ? subsLoading : isLoading
  const activeError = isSubscriberView ? subsError : error
  const activeRefreshing = isSubscriberView ? subsRefreshing : isRefreshing
  const columnCount = isSubscriberView ? 3 : 5

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

        {upcomingPayouts.length > 0 && (
          <section className="relative overflow-hidden rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.08] p-6 sm:p-8 shadow-[0_32px_110px_rgba(6,24,24,0.55)]">
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
                  Auto-refreshes every second • {upcomingPayouts.length} wallet{upcomingPayouts.length === 1 ? '' : 's'} in cycle
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {upcomingPayouts.map((payout) => {
                  const isReady = payout.remaining <= 0
                  const denominator = Math.max(payout.nextPayoutAt - payout.lastApprovedAt, DAY_MS)
                  const progress = Math.min(1, Math.max(0, (nowTs - payout.lastApprovedAt) / denominator))
                  return (
                    <div
                      key={payout.address}
                      className={`relative overflow-hidden rounded-3xl border px-5 py-4 shadow-[0_18px_60px_rgba(2,22,16,0.45)] ${
                        isReady ? 'border-emerald-300/60 bg-emerald-400/15' : 'border-white/10 bg-black/35'
                      }`}
                    >
                      <div className="pointer-events-none absolute inset-0 rounded-3xl border border-white/5" />
                      <div className="relative flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[10px] uppercase tracking-[0.28em] text-white/50">{isReady ? 'Ready to settle' : 'In progress'}</div>
                          <span
                            className={`inline-flex h-2 w-2 rounded-full ${
                              isReady ? 'bg-emerald-300 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.9)]' : 'bg-sky-300'
                            }`}
                          />
                        </div>
                        <div className="text-sm text-white/65">{payout.address}</div>
                        <div className={`text-3xl font-semibold ${isReady ? 'text-emerald-100' : 'text-white'}`}>
                          {formatCountdown(payout.remaining)}
                        </div>
                        <div className="rounded-full bg-white/10">
                          <div
                            className={`h-1.5 rounded-full ${
                              isReady ? 'bg-emerald-300' : 'bg-gradient-to-r from-emerald-300 via-teal-300 to-sky-300'
                            }`}
                            style={{ width: `${Math.round(progress * 100)}%` }}
                          />
                        </div>
                        <div className="grid gap-1 text-xs text-white/60">
                          <div>
                            Last approval: <span className="text-white/80">{formatDateTime(payout.lastApprovedAt)}</span>
                          </div>
                          <div>
                            Next payout: <span className="text-white/80">{formatDateTime(payout.nextPayoutAt)}</span>
                          </div>
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
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        )}

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
              {activeRefreshing ? 'Refreshing…' : isSubscriberView ? 'Auto refresh every 60s' : `Auto refresh every ${REFRESH_MS / 1000}s`}
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
