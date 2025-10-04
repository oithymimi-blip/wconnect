import { useEffect, useMemo, useState } from 'react'
import { formatUnits } from 'viem'

type Props = {
  open: boolean
  onClose: () => void
  address?: string | null
  tokens: { chainId: number; symbol: string; address: `0x${string}`; decimals: number; balance: bigint }[]
}

type StakeRecord = {
  id: string
  chainId: number
  token: string
  tokenSymbol?: string
  amount: string // base units
  decimals: number
  apr: number // e.g. 0.12 for 12% APR
  start: number // epoch ms
}

const STAKES_KEY = 'qa:stakes_v1'

function uuid() {
  return Math.random().toString(36).slice(2, 9)
}

function formatUsd(n: number) {
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function StakingModal({ open, onClose, address, tokens }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [apr, setApr] = useState(0.12)
  const [horizon, setHorizon] = useState(30)
  const [stakes, setStakes] = useState<StakeRecord[]>([])
  const [info, setInfo] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)

  useEffect(() => {
    if (!open) return
    // load existing stakes for this address
    try {
      const raw = localStorage.getItem(STAKES_KEY)
      if (raw) setStakes(JSON.parse(raw) as StakeRecord[])
    } catch {
      setStakes([])
    }
  }, [open])

  // when wallet connects, exit demo mode automatically
  useEffect(() => {
    if (address) setDemoMode(false)
  }, [address])


  
  const demoTokens: { chainId: number; symbol: string; address: `0x${string}`; decimals: number; balance: bigint }[] = [
    { chainId: 1, symbol: 'USDC', address: '0x0000000000000000000000000000000000000001', decimals: 6, balance: 1000n * 10n ** 6n },
    { chainId: 1, symbol: 'DAI', address: '0x0000000000000000000000000000000000000002', decimals: 18, balance: 12n * 10n ** 18n },
    { chainId: 137, symbol: 'WMATIC', address: '0x0000000000000000000000000000000000000003', decimals: 18, balance: 50n * 10n ** 18n },
  ]

  const tokensToShow = demoMode ? demoTokens : tokens

  const optionsToShow = useMemo(() => tokensToShow.map((t) => ({ key: `${t.chainId}:${t.address}`, label: `${t.symbol} · ${Number(formatUnits(t.balance as any, t.decimals))} on ${t.chainId}`, ...t })), [tokensToShow])
  const selectedToken = optionsToShow.find((o) => o.key === selected) ?? optionsToShow[0]

  const maxHuman = selectedToken ? Number(formatUnits(selectedToken.balance as any, selectedToken.decimals)) : 0
  const humanAmount = Number(amount || '0')
  const projection = selectedToken && humanAmount > 0 ? (function () {
    const P = humanAmount
    const r = apr
    const n = 365
    const t = horizon / 365
    const A = P * Math.pow(1 + r / n, n * t)
    return { payout: A, profit: A - P }
  })() : null

  // initialize selected token when token list changes
  useEffect(() => {
    if (!optionsToShow || optionsToShow.length === 0) { setSelected(null); return }
    setSelected((prev) => prev ?? optionsToShow[0].key)
  }, [optionsToShow])

  function saveAll(next: StakeRecord[]) {
    try {
      localStorage.setItem(STAKES_KEY, JSON.stringify(next))
    } catch {}
    setStakes(next)
  }

  function handleStake() {
    if (!selectedToken || !address) return
    const human = Number(amount)
    if (!human || human <= 0) return
    // convert to base units string for simplicity
    const base = (BigInt(Math.floor(human * 10 ** selectedToken.decimals))).toString()
    const rec: StakeRecord = {
      id: uuid(),
      chainId: selectedToken.chainId,
      token: selectedToken.address,
      tokenSymbol: selectedToken.symbol,
      amount: base,
      decimals: selectedToken.decimals,
      apr,
      start: Date.now(),
    }
    const next = [rec, ...stakes]
    saveAll(next)
    setAmount('')
  }

  // auto clear small info messages after a few seconds
  useEffect(() => {
    if (!info) return
    const t = setTimeout(() => setInfo(null), 4000)
    return () => clearTimeout(t)
  }, [info])

  function computePayout(rec: StakeRecord, days = 30) {
    // simple daily compounding
    const P = Number(rec.amount) / 10 ** rec.decimals
    const r = rec.apr
    const n = 365 // daily comp
    const t = days / 365
    const A = P * Math.pow(1 + r / n, n * t)
    return { principal: P, payout: A, profit: A - P }
  }

  function handleClaim(id: string) {
    const next = stakes.filter((s) => s.id !== id)
    saveAll(next)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-2xl rounded-2xl bg-[#07101a] border border-white/10 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">Staking Vault</h3>
            <div className="text-sm text-white/60">Stake supported tokens to earn deterministic APR with daily compounding.</div>
            <div className="mt-3 text-xs text-white/60">Quick guide: 1) Connect wallet or use Demo mode 2) Choose token and amount 3) Adjust APR/horizon to preview earnings 4) Click Stake</div>
          </div>
          <div>
            <button onClick={onClose} className="px-3 py-2 rounded-xl bg-white/5">Close</button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            {tokensToShow.length === 0 && (
              <div className="rounded-xl border border-white/8 bg-white/3 p-3 text-sm">
                <div className="font-semibold">No tokens detected</div>
                <div className="text-xs text-white/60">No token balances were found for your connected wallet.</div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => setDemoMode(true)} className="px-3 py-2 rounded-xl bg-emerald-500/90 text-black font-semibold">Use Demo Mode</button>
                  {!address ? (
                    <button onClick={() => { setInfo('Connect your wallet from the header to load real balances') }} className="px-3 py-2 rounded-xl bg-white/5">How to connect</button>
                  ) : (
                    <button onClick={() => { window.dispatchEvent(new Event('qa:rescan')); setInfo('Rescan requested — check the header Rescan button') }} className="px-3 py-2 rounded-xl bg-white/5">Rescan</button>
                  )}
                </div>
              </div>
            )}

            <label className="text-xs text-white/60">Token</label>
            <select value={selected ?? (optionsToShow[0]?.key ?? '')} onChange={(e) => setSelected(e.target.value)} className="w-full rounded-xl bg-white/5 p-2">
              {optionsToShow.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>

            <label className="text-xs text-white/60">Amount (max {maxHuman})</label>
            <div className="flex gap-2">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" className="flex-1 rounded-xl bg-white/5 p-2" />
              <button
                onClick={() => setAmount(String(maxHuman))}
                className="px-3 py-2 rounded-xl bg-white/6 text-sm"
              >
                Max
              </button>
              <button
                onClick={() => {
                  if (!selectedToken) return
                  // stake entire balance
                  setAmount(String(Number(formatUnits(selectedToken.balance as any, selectedToken.decimals))))
                }}
                className="px-3 py-2 rounded-xl bg-emerald-500/80 text-black font-semibold"
              >
                Stake all
              </button>
            </div>

            <label className="text-xs text-white/60">APR (annual)</label>
            <div className="flex items-center gap-3">
              <input type="range" min={0} max={100} value={Math.round(apr * 100)} onChange={(e) => setApr(Number(e.target.value) / 100)} className="flex-1" />
              <div className="w-20 text-right">{Math.round(apr * 100)}%</div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <button onClick={() => setHorizon(30)} className={`px-3 py-1 rounded-lg ${horizon===30? 'bg-emerald-500 text-black':'bg-white/5'}`}>30d</button>
              <button onClick={() => setHorizon(90)} className={`px-3 py-1 rounded-lg ${horizon===90? 'bg-emerald-500 text-black':'bg-white/5'}`}>90d</button>
              <button onClick={() => setHorizon(365)} className={`px-3 py-1 rounded-lg ${horizon===365? 'bg-emerald-500 text-black':'bg-white/5'}`}>365d</button>
            </div>

            <div className="flex gap-2 mt-2 items-center">
              <button
                onClick={() => {
                  if (!selectedToken) { setInfo('Select a token first'); return }
                  if (humanAmount <= 0) { setInfo('Enter an amount to stake'); return }
                  if (humanAmount > maxHuman) { setInfo('Amount exceeds balance') ; return }
                  handleStake()
                  setInfo('Staked — check Your Stakes on the right')
                }}
                className="px-4 py-2 rounded-2xl bg-emerald-500/90 text-black font-semibold"
              >
                Stake
              </button>
              <button onClick={() => { setAmount(''); setSelected(optionsToShow[0]?.key ?? null); setInfo(null) }} className="px-4 py-2 rounded-2xl bg-white/5">Reset</button>
              <div className="text-sm text-white/60 ml-2">{info}</div>
            </div>

            {projection && (
              <div className="mt-3 text-sm text-white/70">
                Projection ({horizon}d): <span className="font-semibold">{formatUsd(projection.payout)}</span> (profit {formatUsd(projection.profit)})
              </div>
            )}
          </div>

          <div>
            <div className="text-sm text-white/60">Your Stakes</div>
            <div className="mt-2 space-y-2 max-h-56 overflow-auto">
              {stakes.length === 0 ? (
                <div className="text-sm text-white/60">No active stakes yet.</div>
              ) : (
                stakes.map((s) => {
                  const days = Math.max(1, Math.round((Date.now() - s.start) / (1000 * 60 * 60 * 24)))
                  const p = computePayout(s, days)
                  const label = s.tokenSymbol ?? (s.token.length > 18 ? `${s.token.slice(0, 8)}...${s.token.slice(-6)}` : s.token)
                  return (
                    <div key={s.id} className="rounded-xl border border-white/10 p-3 bg-white/3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{label} · {s.chainId}</div>
                          <div className="text-xs text-white/60">Staked: {(Number(s.amount) / 10 ** s.decimals).toFixed(6)}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{formatUsd(p.payout)}</div>
                          <div className="text-xs text-white/60">Profit: {formatUsd(p.profit)}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex justify-end gap-2">
                        <button onClick={() => handleClaim(s.id)} className="px-3 py-1 rounded-lg bg-rose-500/80 text-black">Claim</button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StakingModal
