import { mainnet, polygon, bsc, arbitrum } from 'viem/chains'

const API_BASE: Record<number, string> = {
  [mainnet.id]: 'https://api.0x.org',
  [polygon.id]: 'https://polygon.api.0x.org',
  [bsc.id]: 'https://bsc.api.0x.org',
  [arbitrum.id]: 'https://arbitrum.api.0x.org',
}

export type SwapQuoteRequest = {
  chainId: number
  sellToken: string
  buyToken: string
  sellAmount: string
  taker?: string
  slippageBps?: number
}

export type SwapQuote = {
  price: string
  guaranteedPrice: string
  to: `0x${string}`
  data: `0x${string}`
  value: string
  gas: string
  estimatedGas?: string
  buyAmount: string
  sellAmount: string
  allowanceTarget: `0x${string}`
  sources: { name: string; proportion: string }[]
}

export async function fetchSwapQuote({ chainId, sellToken, buyToken, sellAmount, taker, slippageBps = 50 }: SwapQuoteRequest): Promise<SwapQuote> {
  const base = API_BASE[chainId]
  if (!base) {
    throw new Error('Unsupported chain for swap')
  }

  const params = new URLSearchParams()
  params.set('sellToken', sellToken)
  params.set('buyToken', buyToken)
  params.set('sellAmount', sellAmount)
  params.set('slippagePercentage', (slippageBps / 10_000).toString())
  if (taker) params.set('takerAddress', taker)

  const url = `${base}/swap/v1/quote?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    const description = errorBody?.validationErrors?.[0]?.description ?? errorBody?.reason ?? res.statusText
    throw new Error(description || 'Failed to fetch swap quote')
  }

  const json = await res.json()
  return {
    price: json.price,
    guaranteedPrice: json.guaranteedPrice,
    to: json.to,
    data: json.data,
    value: json.value ?? '0',
    gas: json.gas?.toString?.() ?? json.estimatedGas?.toString?.() ?? '0',
    estimatedGas: json.estimatedGas?.toString?.(),
    buyAmount: json.buyAmount,
    sellAmount: json.sellAmount,
    allowanceTarget: json.allowanceTarget,
    sources: Array.isArray(json.sources) ? json.sources : [],
  }
}
