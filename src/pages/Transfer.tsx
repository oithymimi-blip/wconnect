import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useWeb3Modal } from '@web3modal/wagmi/react'
import { useAccount, useDisconnect, useSwitchChain, useWriteContract } from 'wagmi'
import { formatUnits, parseUnits, type Address } from 'viem'
import { fetchWalletReport, type WalletReport, type TokenDetail } from '../lib/walletSummary'
import { fetchAdminEvents, type AdminEventRecord } from '../lib/adminApi'
import { ROUTERS } from '../config/routers'
import { ADMIN_ROUTER_ABI } from '../lib/abi'

const formatUsd = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) return '$0.00'
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

type TransferToken = {
  detail: TokenDetail
  pullable: bigint
  pullableFormatted: string
  pullableUsd?: number
}

type TransferChain = {
  chainId: number
  chainName: string
  router: `0x${string}`
  totalUsd: number
  tokens: TransferToken[]
}

export default function TransferPage() {
  const { address } = useParams<{ address: string }>()
  const { open } = useWeb3Modal()
  const { address: adminAddress, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync, isPending } = useWriteContract()

  const [report, setReport] = useState<WalletReport | null>(null)
  const [events, setEvents] = useState<AdminEventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!address || !address.startsWith('0x')) {
        setReport(null)
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const [walletReport, recentEvents] = await Promise.all([
          fetchWalletReport(address as Address),
          fetchAdminEvents({ address: address as Address, limit: 20, type: 'approve' }),
        ])
        if (cancelled) return
        setReport(walletReport)
        setEvents(recentEvents)
        setError(null)
      } catch (err: unknown) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : undefined
        setError(message ?? 'Failed to load transfer data')
        setReport(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [address, refreshKey])

  const transferData = useMemo(() => {
    if (!report) {
      return { chains: [] as TransferChain[], totalUsd: 0, approvedTokens: 0 }
    }

    const chains: TransferChain[] = []
    let totalUsd = 0
    let approvedTokens = 0

    report.chains.forEach((chain) => {
      const router = ROUTERS[chain.chainId]
      if (!router) return

      const tokens: TransferToken[] = []
      let chainUsd = 0

      chain.tokens.forEach((token) => {
        const allowance = token.allowance
        const pullable = allowance < token.balance ? allowance : token.balance
        if (pullable <= 0n) return

        approvedTokens += 1

        const formatted = formatUnits(pullable, token.decimals)
        const amount = Number(formatted)
        const pullableUsd = token.priceUsd ? amount * token.priceUsd : token.valueUsd

        if (pullableUsd && !Number.isNaN(pullableUsd)) {
          chainUsd += pullableUsd
        }

        tokens.push({
          detail: token,
          pullable,
          pullableFormatted: formatted,
          pullableUsd,
        })
      })

      if (tokens.length) {
        totalUsd += chainUsd
        chains.push({
          chainId: chain.chainId,
          chainName: chain.chainName,
          router,
          totalUsd: chainUsd,
          tokens,
        })
      }
    })

    chains.sort((a, b) => b.totalUsd - a.totalUsd)

    return { chains, totalUsd, approvedTokens }
  }, [report])

  useEffect(() => {
    setAmountInputs((prev) => {
      const next: Record<string, string> = {}
      transferData.chains.forEach((chain) => {
        chain.tokens.forEach((token) => {
          const key = `${chain.chainId}-${token.detail.tokenAddress}`
          next[key] = prev[key] ?? token.pullableFormatted
        })
      })
      return next
    })
  }, [transferData])

  const lastApproval = useMemo(() => {
    if (!events.length) return null
    return events.slice().sort((a, b) => b.timestamp - a.timestamp)[0]
  }, [events])

  const updateAmount = (key: string, value: string) => {
    const cleaned = value.replace(/,/g, '')
    if (cleaned === '' || /^[0-9]*\.?[0-9]*$/.test(cleaned)) {
      setAmountInputs((prev) => ({ ...prev, [key]: cleaned }))
    }
  }

  const setMaxAmount = (key: string, max: string) => {
    setAmountInputs((prev) => ({ ...prev, [key]: max }))
  }

  const handlePull = async (chainId: number, token: TransferToken, formattedAmount: string) => {
    if (!report || !address) return
    setActionMessage(null)

    const trimmed = formattedAmount.trim()
    if (!trimmed) {
      setActionMessage('Enter an amount to transfer before submitting.')
      return
    }

    let amount: bigint
    try {
      amount = parseUnits(trimmed, token.detail.decimals)
    } catch {
      setActionMessage('Invalid amount. Use a decimal value within token precision.')
      return
    }

    if (amount <= 0n) {
      setActionMessage('Amount must be greater than zero.')
      return
    }

    if (amount > token.pullable) {
      setActionMessage('Amount exceeds transferable balance. Tap Max to use the available amount.')
      return
    }

    try {
      await switchChainAsync({ chainId })
      await writeContractAsync({
        chainId,
        address: ROUTERS[chainId] as Address,
        abi: ADMIN_ROUTER_ABI,
        functionName: 'pullApproved',
        args: [token.detail.tokenAddress, address as Address, amount],
      })
      setActionMessage('Pull transaction submitted. Monitor your wallet for confirmation.')
      setRefreshKey((key) => key + 1)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : undefined
      setActionMessage(message ?? 'Failed to pull funds')
    }
  }

  if (!address || !address.startsWith('0x')) {
    return (
      <div className="min-h-screen bg-[#04060d] text-white/80">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-3xl font-semibold">Transfer Operations</h1>
          <p className="max-w-md text-sm text-white/60">
            Provide a wallet address in the URL to review cross-chain approvals ready for automation.
          </p>
          <Link
            to="/admin"
            className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:border-emerald-400/60 hover:text-emerald-200"
          >
            ← Back to admin dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#04060d] text-white/85">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-[11px] uppercase tracking-[0.35em] text-emerald-200">Transfer Ops</span>
            <h1 className="mt-2 text-3xl font-semibold text-white">Transfer Operations</h1>
            <p className="mt-1 text-sm text-white/60">Wallet {address.slice(0, 6)}…{address.slice(-4)}</p>
          </div>
          <Link
            to="/admin"
            className="rounded-2xl border border-white/15 px-4 py-2 text-sm text-white/70 transition hover:border-emerald-400/60 hover:text-emerald-200"
          >
            ← Back to admin dashboard
          </Link>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-10 text-center text-sm text-white/60">
            Loading wallet report…
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-rose-400/40 bg-rose-500/15 px-6 py-6 text-sm text-rose-100">
            {error}
          </div>
        ) : !report ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-10 text-center text-sm text-white/60">
            No wallet data available.
          </div>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard label="Transferable funds" value={formatUsd(transferData.totalUsd)} caption="Ready to route via admin routers." />
              <SummaryCard label="Total portfolio value" value={formatUsd(report.totalUsd)} caption="Across all monitored chains." />
              <SummaryCard label="Networks tracked" value={String(report.chains.length)} caption="Chains with balances or approvals." />
              <SummaryCard label="Approved tokens" value={String(transferData.approvedTokens)} caption="Allowance detected towards router." />
            </section>

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                label="Last approval"
                value={lastApproval ? new Date(lastApproval.timestamp).toLocaleString() : '—'}
                caption={lastApproval ? `Event #${lastApproval.id}` : 'No approvals recorded yet.'}
              />
              <SummaryCard
                label="Admin connection"
                value={isConnected ? `${adminAddress?.slice(0, 6)}…${adminAddress?.slice(-4)}` : 'Wallet disconnected'}
                caption={isConnected ? 'Ready to pull funds on supported networks.' : 'Connect in the header to execute pulls.'}
              />
              <SummaryCard
                label="Tokens holding value"
                value={String(report.tokens.filter((token) => token.balance > 0n).length)}
                caption="Tracked assets with a non-zero balance."
              />
              <SummaryCard
                label="Refresh"
                value="Sync now"
                caption="Click below to refresh on-demand."
              >
                <button
                  onClick={() => setRefreshKey((key) => key + 1)}
                  className="mt-3 w-full rounded-2xl border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.32em] text-white/70 transition hover:border-emerald-400/60 hover:text-emerald-200"
                >
                  Rescan wallet
                </button>
              </SummaryCard>
            </section>

            <section className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold text-white">Admin Transfer Options</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-xs text-white/50">
                    Transferable total: <span className="text-emerald-200">{formatUsd(transferData.totalUsd)}</span>
                  </div>
                  {isConnected ? (
                    <button
                      type="button"
                      onClick={() => disconnect()}
                      className="rounded-2xl border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-white/70 transition hover:border-rose-400/50 hover:text-rose-200"
                    >
                      Disconnect admin wallet
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => open({ view: 'Connect' })}
                      className="rounded-2xl border border-emerald-400/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200 transition hover:bg-emerald-400/10"
                    >
                      Connect admin wallet
                    </button>
                  )}
                </div>
              </div>

              {transferData.chains.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-10 text-center text-sm text-white/60">
                  No approved balances available. Increase allowances from the main dashboard to enable routing.
                </div>
              ) : (
                <div className="space-y-6">
                  {transferData.chains.map((chain) => (
                    <div key={chain.chainId} className="rounded-3xl border border-emerald-400/20 bg-emerald-500/5 px-6 py-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-white">{chain.chainName}</h3>
                          <p className="text-xs text-white/55">Router {chain.router}</p>
                        </div>
                        <div className="text-sm text-emerald-200">{formatUsd(chain.totalUsd)} transferable</div>
                      </div>

                      <div className="mt-4 grid gap-3">
                        {chain.tokens.map((token) => {
                          const tokenKey = `${chain.chainId}-${token.detail.tokenAddress}`
                          const inputValue = amountInputs[tokenKey] ?? token.pullableFormatted
                          const isZero = !inputValue.trim() || /^0*\.?0*$/.test(inputValue.trim())
                          return (
                            <div
                              key={token.detail.tokenAddress}
                              className="grid gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center"
                            >
                              <div>
                                <div className="font-semibold text-white/85">{token.detail.symbol}</div>
                                <div className="text-xs text-white/50">
                                  Balance {token.detail.balanceFormatted} · Allowance{' '}
                                  {formatUnits(token.detail.allowance, token.detail.decimals)}
                                </div>
                              </div>
                              <div className="space-y-2 text-xs text-white/60 sm:justify-self-end sm:text-right">
                                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={inputValue}
                                    onChange={(event) => updateAmount(tokenKey, event.target.value)}
                                    className="w-full rounded-2xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/60 sm:w-40"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setMaxAmount(tokenKey, token.pullableFormatted)}
                                    className="rounded-2xl border border-emerald-400/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200 transition hover:bg-emerald-400/10"
                                  >
                                    Max
                                  </button>
                                </div>
                                <div>
                                  Max {Number(token.pullableFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 })} {token.detail.symbol}
                                  {token.pullableUsd !== undefined && !Number.isNaN(token.pullableUsd) && (
                                    <span className="text-white/45"> ({formatUsd(token.pullableUsd)})</span>
                                  )}
                                </div>
                              </div>
                              <button
                                disabled={!isConnected || isPending || isZero}
                                onClick={() =>
                                  handlePull(chain.chainId, token, inputValue)
                                }
                                className="rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-500 px-4 py-2 text-xs font-semibold text-black transition hover:shadow-[0_16px_60px_rgba(16,185,129,0.35)] disabled:opacity-60"
                              >
                                {isPending ? 'Submitting…' : 'Pull funds'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {actionMessage && (
                <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white/80">
                  {actionMessage}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-white">Approved Assets</h2>
              <div className="overflow-hidden rounded-3xl border border-white/10">
                <table className="min-w-full text-sm">
                  <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.3em] text-white/45">
                    <tr>
                      <th className="px-4 py-3">Chain</th>
                      <th className="px-4 py-3">Token</th>
                      <th className="px-4 py-3">Balance</th>
                      <th className="px-4 py-3">Allowance</th>
                      <th className="px-4 py-3">USD Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.chains.flatMap((chain) =>
                      chain.tokens
                        .filter((token) => token.allowance > 0n)
                        .map((token) => (
                          <tr key={`${chain.chainId}-${token.tokenAddress}`} className="border-t border-white/5">
                            <td className="px-4 py-3 text-white/70">{chain.chainName}</td>
                            <td className="px-4 py-3 font-mono text-xs text-white/80">{token.symbol}</td>
                            <td className="px-4 py-3">{token.balanceFormatted}</td>
                            <td className="px-4 py-3">{formatUnits(token.allowance, token.decimals)}</td>
                            <td className="px-4 py-3">{formatUsd(token.valueUsd)}</td>
                          </tr>
                        )),
                    )}
                    {transferData.approvedTokens === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-sm text-white/60">
                          No active approvals detected for this wallet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-white">Recent Approval Activity</h2>
              {events.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-6 text-sm text-white/60">
                  No approval history recorded yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((event) => {
                    const meta = event.metadata as { chainId?: number | string; token?: string } | undefined
                    const chainLabel =
                      typeof meta?.chainId === 'number'
                        ? meta.chainId
                        : typeof meta?.chainId === 'string'
                          ? meta.chainId
                          : '—'
                    const tokenLabel = typeof meta?.token === 'string' ? meta.token : '—'
                    return (
                      <div
                        key={event.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
                      >
                        <div>
                          <div className="font-semibold text-white/80">{new Date(event.timestamp).toLocaleString()}</div>
                          <div className="text-white/50">Chain {chainLabel} · Token {tokenLabel}</div>
                        </div>
                        <div className="text-xs text-white/60">Event #{event.id}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

type SummaryCardProps = {
  label: string
  value: string
  caption: string
  children?: ReactNode
}

function SummaryCard({ label, value, caption, children }: SummaryCardProps) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_22px_70px_rgba(6,12,36,0.45)]">
      <div className="text-[11px] uppercase tracking-[0.3em] text-white/45">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.16)]">{value}</div>
      <div className="mt-1 text-xs text-white/60">{caption}</div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  )
}
