import { useEffect, useMemo, useState } from 'react'
import {
  useAccount,
  useBalance,
  useChainId,
  useReadContract,
  useSendTransaction,
  useSwitchChain,
  useWriteContract,
} from 'wagmi'
import { erc20Abi, formatUnits, parseUnits } from 'viem'
import type { Address } from 'viem'
import { CHAINS_DEF } from '../lib/clients'
import { TOKENS } from '../config/tokens'
import { fetchBridgeQuote, type BridgeQuote } from '../lib/bridge'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const satisfies Address
const MAX_APPROVAL = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

type ChainToken = {
  symbol: string
  address: Address
  decimals: number
}

type BridgeModalProps = {
  open: boolean
  onClose: () => void
  initialFromChainId?: number
}

export function BridgeModal({ open, onClose, initialFromChainId }: BridgeModalProps) {
  const { address, isConnected } = useAccount()
  const activeChainId = useChainId()
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain()
  const { writeContractAsync, isPending: isApproving } = useWriteContract()
  const { sendTransactionAsync, isPending: isBridging } = useSendTransaction()

  const initialFromChain = useMemo(() => initialFromChainId ?? activeChainId ?? CHAINS_DEF[0].id, [initialFromChainId, activeChainId])
  const [fromChainId, setFromChainId] = useState<number>(initialFromChain)
  const [toChainId, setToChainId] = useState<number>(() => {
    const firstAlt = CHAINS_DEF.find((chain) => chain.id !== initialFromChain)
    return firstAlt?.id ?? CHAINS_DEF[0].id
  })

  const fromTokens = TOKENS[fromChainId] ?? []
  const toTokens = TOKENS[toChainId] ?? []

  const [fromToken, setFromToken] = useState<ChainToken | null>(() => fromTokens[0] ?? null)
  const [toToken, setToToken] = useState<ChainToken | null>(() => {
    if (!fromTokens[0]) return toTokens[0] ?? null
    const match = toTokens.find((token) => token.symbol.toLowerCase() === fromTokens[0].symbol.toLowerCase())
    return match ?? toTokens[0] ?? null
  })

  const [amountInput, setAmountInput] = useState('')
  const [slippage, setSlippage] = useState('0.50')
  const [quote, setQuote] = useState<BridgeQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isQuoting, setIsQuoting] = useState(false)

  const fromTokenIsNative = fromToken?.address === ZERO_ADDRESS

  const amountValue = useMemo(() => {
    if (!fromToken || !amountInput) return null
    try {
      return parseUnits(amountInput, fromToken.decimals)
    } catch {
      return null
    }
  }, [amountInput, fromToken])

  useEffect(() => {
    if (!open) return
    setFromChainId(initialFromChain)
    const nextTo = CHAINS_DEF.find((chain) => chain.id !== initialFromChain)
    setToChainId(nextTo?.id ?? initialFromChain)
  }, [initialFromChain, open])

  useEffect(() => {
    if (!open) return
    const defaults = TOKENS[fromChainId] ?? []
    setFromToken((prev) => (prev && defaults.some((token) => token.address === prev.address) ? prev : defaults[0] ?? null))
    setQuote(null)
    setStatusMessage(null)
  }, [fromChainId, open])

  useEffect(() => {
    if (!open) return
    const defaults = TOKENS[toChainId] ?? []
    setToToken((prev) => (prev && defaults.some((token) => token.address === prev.address) ? prev : defaults[0] ?? null))
    setQuote(null)
    setStatusMessage(null)
  }, [toChainId, open])

  const balanceQuery = useBalance({
    address,
    chainId: fromChainId,
    token: fromTokenIsNative ? undefined : fromToken?.address,
    query: {
      enabled: Boolean(open && address && fromToken),
      refetchInterval: 20_000,
    },
  })

  const allowanceQuery = useReadContract({
    chainId: fromChainId,
    abi: erc20Abi,
    address: !fromTokenIsNative ? fromToken?.address : undefined,
    functionName: 'allowance',
    args:
      address && quote?.estimate.approvalAddress && !fromTokenIsNative
        ? [address, quote.estimate.approvalAddress as Address]
        : undefined,
    query: {
      enabled: Boolean(open && address && quote?.estimate.approvalAddress && !fromTokenIsNative && fromToken),
    },
  })

  const allowance = allowanceQuery.data ?? 0n

  useEffect(() => {
    if (!open) return
    if (!address) {
      setQuote(null)
      setQuoteError('Connect your wallet to fetch bridge routes.')
      return
    }

    if (!fromToken || !toToken) {
      setQuote(null)
      setQuoteError('Select a token pair to bridge.')
      return
    }

    if (fromChainId === toChainId) {
      setQuote(null)
      setQuoteError('Choose different source and destination networks.')
      return
    }

    if (!amountValue || amountValue <= 0n) {
      setQuote(null)
      setQuoteError(null)
      return
    }

    const slippageFloat = Number.parseFloat(slippage)
    if (Number.isNaN(slippageFloat) || slippageFloat < 0 || slippageFloat > 5) {
      setQuote(null)
      setQuoteError('Slippage must be between 0 and 5%')
      return
    }

    let cancelled = false
    const delay = setTimeout(() => {
      setIsQuoting(true)
      setQuoteError(null)
      fetchBridgeQuote({
        fromChainId,
        toChainId,
        fromToken: fromToken.address,
        toToken: toToken.address,
        fromAmount: amountValue.toString(),
        fromAddress: address,
        toAddress: address,
        slippageBps: Math.round(slippageFloat * 100),
      })
        .then((result) => {
          if (!cancelled) {
            setQuote(result)
            setStatusMessage(null)
          }
        })
        .catch((err: any) => {
          if (!cancelled) {
            setQuote(null)
            setQuoteError(err?.message ?? 'Failed to fetch bridge quote')
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsQuoting(false)
          }
        })
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(delay)
      setIsQuoting(false)
    }
  }, [address, amountValue, fromChainId, fromToken, open, slippage, toChainId, toToken])

  const approvalNeeded = useMemo(() => {
    if (!quote || fromTokenIsNative) return false
    if (!quote.estimate.approvalAddress) return false
    if (!amountValue) return false
    return allowance < amountValue
  }, [allowance, amountValue, fromTokenIsNative, quote])

  const formattedBalance = balanceQuery.data
    ? Number(
        formatUnits(
          balanceQuery.data.value,
          balanceQuery.data.decimals ?? fromToken?.decimals ?? 18,
        ),
      ).toLocaleString(undefined, { maximumFractionDigits: 6 })
    : '0'

  const estimatedReceive = quote && toToken
    ? Number(
        formatUnits(BigInt(quote.estimate.toAmount), toToken.decimals),
      ).toLocaleString(undefined, { maximumFractionDigits: 6 })
    : '—'

  const minReceive = quote && toToken
    ? Number(
        formatUnits(BigInt(quote.estimate.toAmountMin ?? quote.estimate.toAmount), toToken.decimals),
      ).toLocaleString(undefined, { maximumFractionDigits: 6 })
    : null

  const handleSetMax = () => {
    if (!balanceQuery.data || !fromToken) return
    const decimals = balanceQuery.data.decimals ?? fromToken.decimals
    setAmountInput(formatUnits(balanceQuery.data.value, decimals))
  }

  const handleApprove = async () => {
    if (!quote || !fromToken || !quote.estimate.approvalAddress) return
    try {
      setStatusMessage(null)
      await writeContractAsync({
        chainId: fromChainId,
        address: fromToken.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [quote.estimate.approvalAddress as Address, MAX_APPROVAL],
      })
      await allowanceQuery.refetch()
      setStatusMessage('Approval transaction submitted. Proceed once it confirms.')
    } catch (err: any) {
      setStatusMessage(err?.message ?? 'Approval failed')
    }
  }

  const parseHex = (value?: string) => {
    if (!value) return undefined
    try {
      if (value.startsWith('0x') || value.startsWith('0X')) {
        return BigInt(value)
      }
      return BigInt(value)
    } catch {
      return undefined
    }
  }

  const handleBridge = async () => {
    if (!quote || !address || !fromToken || !toToken) return
    try {
      setStatusMessage(null)
      if (activeChainId !== fromChainId) {
        await switchChainAsync({ chainId: fromChainId })
      }

      const request = quote.transactionRequest
      const txValue = parseHex(request.value) ?? 0n
      const txGasLimit = parseHex(request.gasLimit)
      const txGasPrice = parseHex(request.gasPrice)
      const txMaxFee = parseHex(request.maxFeePerGas)
      const txMaxPriority = parseHex(request.maxPriorityFeePerGas)

      await sendTransactionAsync({
        chainId: fromChainId,
        to: request.to as Address,
        data: request.data as `0x${string}`,
        value: txValue,
        gas: txGasLimit,
        gasPrice: txGasPrice,
        maxFeePerGas: txMaxFee,
        maxPriorityFeePerGas: txMaxPriority,
      })

      setStatusMessage('Bridge transaction sent. Track progress in your wallet activity feed.')
      setQuote(null)
      setAmountInput('')
      await balanceQuery.refetch?.()
    } catch (err: any) {
      setStatusMessage(err?.message ?? 'Bridge transaction failed')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#0b0f1b] p-6 text-white/90 shadow-xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-white/40">Automation Module</div>
            <h3 className="text-2xl font-semibold">Cross-Chain Bridge</h3>
            <p className="mt-1 text-sm text-white/60">Move supported assets between networks using aggregated routes.</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl border border-white/15 px-3 py-1.5 text-sm text-white/70 transition hover:border-emerald-400/50 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-white/40">From Network</span>
            <select
              value={fromChainId}
              onChange={(event) => setFromChainId(Number(event.target.value))}
              className="w-full rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-white"
            >
              {CHAINS_DEF.map((chain) => (
                <option key={chain.id} value={chain.id} className="bg-[#0b0f1b]">
                  {chain.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-white/40">Destination Network</span>
            <select
              value={toChainId}
              onChange={(event) => setToChainId(Number(event.target.value))}
              className="w-full rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-white"
            >
              {CHAINS_DEF.filter((chain) => chain.id !== fromChainId).map((chain) => (
                <option key={chain.id} value={chain.id} className="bg-[#0b0f1b]">
                  {chain.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/40">
              <span>Send Token</span>
              <button onClick={handleSetMax} className="text-emerald-300 transition hover:text-emerald-200">
                Max
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <select
                value={fromToken?.address ?? ''}
                onChange={(event) => {
                  const next = fromTokens.find((token) => token.address === event.target.value)
                  if (!next) return
                  setFromToken(next)
                  if (toToken && toToken.symbol.toLowerCase() === next.symbol.toLowerCase()) return
                  const destinationMatch = toTokens.find((token) => token.symbol.toLowerCase() === next.symbol.toLowerCase())
                  if (destinationMatch) setToToken(destinationMatch)
                }}
                className="w-full rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-white"
              >
                {fromTokens.map((token) => (
                  <option key={token.address} value={token.address} className="bg-[#0b0f1b] text-white">
                    {token.symbol}
                  </option>
                ))}
              </select>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-right text-2xl font-semibold tracking-tight"
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-white/50">
              <span>Balance</span>
              <span>{formattedBalance}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/40">
              <span>Receive Token</span>
              <span>{isQuoting ? 'Fetching route…' : ''}</span>
            </div>
            <div className="flex flex-col gap-3">
              <select
                value={toToken?.address ?? ''}
                onChange={(event) => {
                  const next = toTokens.find((token) => token.address === event.target.value)
                  if (next) setToToken(next)
                }}
                className="w-full rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-white"
              >
                {toTokens.map((token) => (
                  <option key={token.address} value={token.address} className="bg-[#0b0f1b] text-white">
                    {token.symbol}
                  </option>
                ))}
              </select>
              <div className="rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-right text-2xl font-semibold tracking-tight">
                {estimatedReceive}
              </div>
            </div>
            {minReceive && (
              <div className="mt-2 flex justify-between text-xs text-white/50">
                <span>Min receive (slippage)</span>
                <span>{minReceive}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-white/40">Slippage %</span>
            <input
              type="number"
              min={0}
              max={5}
              step={0.05}
              value={slippage}
              onChange={(event) => setSlippage(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-white"
            />
          </label>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
            <div className="text-xs uppercase tracking-[0.2em] text-white/40">Duration</div>
            <div className="mt-1 text-lg text-white/90">
              {quote?.estimate.executionDuration ? `${Math.round(quote.estimate.executionDuration / 60)} min` : '—'}
            </div>
            <div className="text-xs text-white/40">Approximate arrival window.</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
            <div className="text-xs uppercase tracking-[0.2em] text-white/40">Est. Receive (USD)</div>
            <div className="mt-1 text-lg text-white/90">{quote?.estimate.toAmountUSD ? `$${Number(quote.estimate.toAmountUSD).toFixed(2)}` : '—'}</div>
            <div className="text-xs text-white/40">Fees already reflected in this estimate.</div>
          </div>
        </div>

        {quote?.estimate.feeCosts && quote.estimate.feeCosts.length > 0 && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-xs uppercase tracking-[0.2em] text-white/40">Fee Breakdown</div>
            <div className="space-y-1 text-sm text-white/70">
              {quote.estimate.feeCosts.map((fee) => (
                <div key={`${fee.name}-${fee.amount}`} className="flex justify-between">
                  <span>{fee.name}</span>
                  <span>
                    {fee.amountUSD ? `$${Number(fee.amountUSD).toFixed(4)}` : fee.amount}
                    {fee.token?.symbol ? ` · ${fee.token.symbol}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {quoteError && (
          <div className="mt-4 rounded-2xl border border-rose-500/50 bg-rose-500/15 px-4 py-3 text-sm text-rose-200">
            {quoteError}
          </div>
        )}

        {statusMessage && (
          <div className="mt-4 rounded-2xl border border-emerald-400/50 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
            {statusMessage}
          </div>
        )}

        {!isConnected && (
          <div className="mt-4 rounded-2xl border border-amber-400/50 bg-amber-400/15 px-4 py-3 text-sm text-amber-200">
            Connect your wallet to run approvals and initiate the bridge.
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {approvalNeeded && (
            <button
              onClick={handleApprove}
              disabled={!isConnected || isApproving}
              className="w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-50 sm:flex-1"
            >
              {isApproving ? 'Approving…' : 'Approve Token'}
            </button>
          )}
          <button
            onClick={handleBridge}
            disabled={
              !isConnected ||
              !quote ||
              isBridging ||
              approvalNeeded ||
              isQuoting ||
              isSwitchingChain ||
              !!quoteError
            }
            className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-sky-500 px-4 py-3 text-sm font-semibold text-black transition disabled:opacity-50 sm:flex-1"
          >
            {isBridging || isSwitchingChain
              ? 'Submitting…'
              : isQuoting
                ? 'Fetching route…'
                : approvalNeeded
                  ? 'Awaiting approval'
                  : 'Start Bridge'}
          </button>
          <button
            onClick={onClose}
            className="w-full rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/70 transition hover:border-white/40 hover:text-white sm:w-auto"
          >
            Cancel
          </button>
        </div>

        <p className="mt-4 text-xs text-white/40">
          Routes are powered by Li.Fi. Gas estimates and completion times are indicative and may vary with network usage.
        </p>
      </div>
    </div>
  )
}
