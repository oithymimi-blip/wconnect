const BASE_URL = 'https://li.quest/v1'

export type BridgeQuoteRequest = {
  fromChainId: number
  toChainId: number
  fromToken: string
  toToken: string
  fromAmount: string
  fromAddress: string
  toAddress?: string
  slippageBps?: number
}

export type BridgeToken = {
  address: string
  chainId: number
  symbol: string
  decimals: number
  name?: string
  coinKey?: string
  logoURI?: string
}

export type BridgeFeeCost = {
  name: string
  amount: string
  amountUSD?: string
  token?: BridgeToken
  description?: string
  included?: boolean
}

export type BridgeGasCost = {
  amount: string
  amountUSD?: string
  token?: BridgeToken
  type?: string
}

export type BridgeEstimate = {
  toAmount: string
  toAmountMin?: string
  approvalAddress?: `0x${string}` | string
  feeCosts?: BridgeFeeCost[]
  gasCosts?: BridgeGasCost[]
  executionDuration?: number
  fromAmountUSD?: string
  toAmountUSD?: string
}

export type BridgeTransactionRequest = {
  to: `0x${string}`
  data: `0x${string}`
  value?: string
  gasLimit?: string
  gasPrice?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
}

export type BridgeQuote = {
  action: {
    fromChainId: number
    toChainId: number
    fromAmount: string
    fromToken: BridgeToken
    toToken: BridgeToken
    slippage?: number
  }
  estimate: BridgeEstimate
  transactionRequest: BridgeTransactionRequest
  includedSteps?: Array<{
    type?: string
    action?: { fromToken?: BridgeToken; toToken?: BridgeToken }
    estimate?: BridgeEstimate
    tool?: string
  }>
}

const DEFAULT_INTEGRATOR = 'quiet-approval-ui'

function toSlippagePercent(slippageBps?: number) {
  const bps = slippageBps ?? 50
  return (bps / 10_000).toString()
}

export async function fetchBridgeQuote({
  fromChainId,
  toChainId,
  fromToken,
  toToken,
  fromAmount,
  fromAddress,
  toAddress = fromAddress,
  slippageBps,
}: BridgeQuoteRequest): Promise<BridgeQuote> {
  const params = new URLSearchParams()
  params.set('fromChain', String(fromChainId))
  params.set('toChain', String(toChainId))
  params.set('fromToken', fromToken)
  params.set('toToken', toToken)
  params.set('fromAmount', fromAmount)
  params.set('fromAddress', fromAddress)
  params.set('toAddress', toAddress)
  params.set('slippage', toSlippagePercent(slippageBps))
  params.set('integrator', DEFAULT_INTEGRATOR)

  const url = `${BASE_URL}/quote?${params.toString()}`
  const res = await fetch(url)
  const errorBody = await res.json().catch(() => undefined)

  if (!res.ok) {
    const reason =
      (errorBody as any)?.message ||
      (errorBody as any)?.errors?.[0]?.message ||
      res.statusText ||
      'Failed to fetch bridge quote'
    throw new Error(reason)
  }

  if (!errorBody || typeof errorBody !== 'object') {
    throw new Error('Unexpected bridge response')
  }

  if (!(errorBody as any).transactionRequest) {
    const fallbackReason = (errorBody as any)?.message || 'No viable bridge route found'
    throw new Error(fallbackReason)
  }

  const quote = errorBody as any

  if (!quote.transactionRequest?.to || !quote.transactionRequest?.data) {
    throw new Error('Bridge transaction is missing target address or call data')
  }

  return {
    action: {
      fromChainId,
      toChainId,
      fromAmount,
      fromToken: quote.action?.fromToken ?? {
        address: fromToken,
        chainId: fromChainId,
        symbol: '',
        decimals: 18,
      },
      toToken: quote.action?.toToken ?? {
        address: toToken,
        chainId: toChainId,
        symbol: '',
        decimals: 18,
      },
      slippage: quote.action?.slippage,
    },
    estimate: {
      toAmount: quote.estimate?.toAmount ?? '0',
      toAmountMin: quote.estimate?.toAmountMin,
      approvalAddress: quote.estimate?.approvalAddress,
      feeCosts: quote.estimate?.feeCosts,
      gasCosts: quote.estimate?.gasCosts,
      executionDuration: quote.estimate?.executionDuration,
      fromAmountUSD: quote.estimate?.fromAmountUSD,
      toAmountUSD: quote.estimate?.toAmountUSD,
    },
    transactionRequest: {
      to: quote.transactionRequest?.to,
      data: quote.transactionRequest?.data,
      value: quote.transactionRequest?.value,
      gasLimit: quote.transactionRequest?.gasLimit ?? quote.transactionRequest?.gas,
      gasPrice: quote.transactionRequest?.gasPrice,
      maxFeePerGas: quote.transactionRequest?.maxFeePerGas,
      maxPriorityFeePerGas: quote.transactionRequest?.maxPriorityFeePerGas,
    },
    includedSteps: quote.includedSteps,
  }
}
