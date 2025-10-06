import { useEffect, useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import type { Address } from 'viem'
import { fetchBridgeQuote } from '../lib/bridge'
import { fetchSwapQuote } from '../lib/swap'
import { TOKENS } from '../config/tokens'

const SAMPLE_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const satisfies Address

export type ModulePreview = {
  loading: boolean
  status: string
  detail?: string
  extra?: string
  error?: string
}

const DEFAULT_PREVIEW: ModulePreview = {
  loading: true,
  status: 'Loading live telemetry…',
}

type LlamaPool = {
  chain: string
  project: string
  symbol: string
  apy?: number | null
  apyBase?: number | null
  apyReward?: number | null
  tvlUsd?: number | null
  poolMeta?: string | null
  apyMean30d?: number | null
}

const LLAMA_ENDPOINT = 'https://yields.llama.fi/pools'

function formatPercent(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 0.01) {
    return `${value.toFixed(2)}%`
  }
  return `${value.toFixed(2)}%`
}

function formatUsd(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`
  }
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`
  }
  if (abs >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`
  }
  if (abs >= 1) {
    return `$${value.toFixed(2)}`
  }
  return `$${value.toFixed(4)}`
}

function listTopSources(sources: { name: string; proportion: string }[]) {
  const active = sources
    .filter((source) => Number.parseFloat(source.proportion) > 0)
    .map((source) => source.name)
  if (!active.length) return 'Aggregator routing'
  if (active.length <= 2) return active.join(', ')
  return `${active.slice(0, 2).join(', ')} +${active.length - 2} more`
}

export function useAutomationPreviews() {
  const [bridgePreview, setBridgePreview] = useState<ModulePreview>(DEFAULT_PREVIEW)
  const [swapPreview, setSwapPreview] = useState<ModulePreview>(DEFAULT_PREVIEW)
  const [stakingPreview, setStakingPreview] = useState<ModulePreview>(DEFAULT_PREVIEW)
  const [liquidityPreview, setLiquidityPreview] = useState<ModulePreview>(DEFAULT_PREVIEW)
  const [llamaPools, setLlamaPools] = useState<LlamaPool[] | null>(null)
  const [llamaError, setLlamaError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadBridge() {
      const fromToken = TOKENS[1]?.find((token) => token.symbol === 'USDC')
      const toToken = TOKENS[42161]?.find((token) => token.symbol === 'USDC')
      if (!fromToken || !toToken) {
        setBridgePreview({
          loading: false,
          status: 'Token metadata unavailable',
          error: 'Missing USDC definitions for preview route.',
        })
        return
      }

      const amount = parseUnits('500', fromToken.decimals)

      try {
        const quote = await fetchBridgeQuote({
          fromChainId: 1,
          toChainId: 42161,
          fromToken: fromToken.address,
          toToken: toToken.address,
          fromAmount: amount.toString(),
          fromAddress: SAMPLE_ADDRESS,
          toAddress: SAMPLE_ADDRESS,
          slippageBps: 50,
        })
        if (cancelled) return

        const minAmountRaw = quote.estimate.toAmountMin ?? quote.estimate.toAmount
        const minAmount = Number(formatUnits(BigInt(minAmountRaw), toToken.decimals))
        const fromUsd = Number.parseFloat(quote.estimate.fromAmountUSD ?? '')
        const toUsd = Number.parseFloat(quote.estimate.toAmountUSD ?? '')
        const feeUsd = Number.isFinite(fromUsd) && Number.isFinite(toUsd) ? fromUsd - toUsd : null
        const etaSeconds = quote.estimate.executionDuration ?? 0
        const etaMinutes = etaSeconds ? Math.max(1, Math.round(etaSeconds / 60)) : null
        const routeTools = quote.includedSteps?.map((step) => step.tool).filter(Boolean) ?? []

        setBridgePreview({
          loading: false,
          status: `USDC → USDC (${minAmount.toFixed(2)} on Arbitrum)`,
          detail: etaMinutes ? `Typical arrival in ~${etaMinutes} min` : 'Instant settlement when route confirms',
          extra: feeUsd && feeUsd > 0 ? `Estimated cost ${formatUsd(feeUsd)}` : routeTools[0] ? `Router: ${routeTools[0]}` : undefined,
        })
      } catch (error: any) {
        if (cancelled) return
        setBridgePreview({
          loading: false,
          status: 'Bridge route unavailable',
          error: error?.message ?? 'Failed to fetch sample route',
        })
      }
    }

    async function loadSwap() {
      const sellToken = TOKENS[1]?.find((token) => token.symbol === 'USDC')
      const buyToken = TOKENS[1]?.find((token) => token.symbol === 'WETH')
      if (!sellToken || !buyToken) {
        setSwapPreview({
          loading: false,
          status: 'Token metadata unavailable',
          error: 'Missing USDC/WETH definitions for swap preview.',
        })
        return
      }

      const amount = parseUnits('100', sellToken.decimals)

      try {
        const quote = await fetchSwapQuote({
          chainId: 1,
          sellToken: sellToken.address,
          buyToken: buyToken.address,
          sellAmount: amount.toString(),
          taker: SAMPLE_ADDRESS,
          slippageBps: 50,
        })
        if (cancelled) return

        const buyAmount = Number(formatUnits(BigInt(quote.buyAmount), buyToken.decimals))
        const sellAmount = Number(formatUnits(BigInt(quote.sellAmount), sellToken.decimals))
        const perUnit = sellAmount > 0 ? buyAmount / sellAmount : 0
        const guaranteed = Number.parseFloat(quote.guaranteedPrice)
        const sourcesLabel = quote.sources ? listTopSources(quote.sources) : undefined

        setSwapPreview({
          loading: false,
          status: `1 ${sellToken.symbol} → ${perUnit.toPrecision(4)} ${buyToken.symbol}`,
          detail: Number.isFinite(guaranteed) ? `Guaranteed rate ${guaranteed.toPrecision(4)}` : sourcesLabel,
          extra: sourcesLabel && Number.isFinite(guaranteed) ? sourcesLabel : undefined,
        })
      } catch (error: any) {
        if (cancelled) return
        setSwapPreview({
          loading: false,
          status: 'Swap quote unavailable',
          error: error?.message ?? 'Failed to fetch sample swap',
        })
      }
    }

    loadBridge()
    loadSwap()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadLlama() {
      try {
        const res = await fetch(LLAMA_ENDPOINT)
        if (!res.ok) {
          throw new Error(res.statusText || 'Failed to load yield data')
        }
        const json = (await res.json()) as { status?: string; data?: LlamaPool[] }
        if (cancelled) return
        if (!json || json.status !== 'success' || !Array.isArray(json.data)) {
          throw new Error('Unexpected response from yield oracle')
        }
        setLlamaPools(json.data)
      } catch (error: any) {
        if (cancelled) return
        setLlamaError(error?.message ?? 'Unable to load yield data')
        setLlamaPools([])
      }
    }

    loadLlama()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!llamaPools || !llamaPools.length) {
      if (llamaError) {
        setStakingPreview({
          loading: false,
          status: 'APR unavailable',
          error: llamaError,
        })
        setLiquidityPreview({
          loading: false,
          status: 'APY unavailable',
          error: llamaError,
        })
      }
      return
    }

    const lido = llamaPools.find((pool) => pool.project === 'lido' && pool.symbol?.toUpperCase() === 'STETH')
    if (lido) {
      setStakingPreview({
        loading: false,
        status: `Net APR ${formatPercent(lido.apy)}`,
        detail: `${formatUsd(lido.tvlUsd)} TVL${lido.apyMean30d ? ` • 30d avg ${formatPercent(lido.apyMean30d)}` : ''}`,
        extra: lido.poolMeta ?? undefined,
      })
    } else if (llamaError) {
      setStakingPreview({
        loading: false,
        status: 'APR unavailable',
        error: llamaError,
      })
    }

    const aaveUsdc =
      llamaPools.find((pool) => pool.project === 'aave-v3' && pool.chain === 'Ethereum' && pool.symbol?.toUpperCase() === 'USDC') ||
      llamaPools.find((pool) => pool.project === 'aave-v3' && pool.symbol?.toUpperCase() === 'USDC')

    if (aaveUsdc) {
      setLiquidityPreview({
        loading: false,
        status: `Supply APY ${formatPercent(aaveUsdc.apy)}`,
        detail: `${formatUsd(aaveUsdc.tvlUsd)} TVL${aaveUsdc.apyBase ? ` • Base ${formatPercent(aaveUsdc.apyBase)}` : ''}`,
        extra: aaveUsdc.apyReward && aaveUsdc.apyReward > 0 ? `Rewards ${formatPercent(aaveUsdc.apyReward)}` : undefined,
      })
    } else if (llamaError) {
      setLiquidityPreview({
        loading: false,
        status: 'APY unavailable',
        error: llamaError,
      })
    }
  }, [llamaPools, llamaError])

  return {
    bridge: bridgePreview,
    swap: swapPreview,
    staking: stakingPreview,
    liquidity: liquidityPreview,
  }
}
