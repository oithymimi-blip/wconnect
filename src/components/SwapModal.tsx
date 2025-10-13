import { useEffect, useMemo, useState } from 'react'
import { useAccount, useBalance, useChainId, useReadContract, useSendTransaction, useSwitchChain, useWriteContract } from 'wagmi'
import { erc20Abi, formatUnits, parseUnits } from 'viem'
import type { Address } from 'viem'
import { CHAINS_DEF } from '../lib/clients'
import { TOKENS } from '../config/tokens'
import { fetchSwapQuote, type SwapQuote } from '../lib/swap'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const satisfies Address
const APPROVAL_AMOUNT = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

type ChainToken = {
  symbol: string
  address: Address
  decimals: number
}

type SwapModalProps = {
  open: boolean
  onClose: () => void
  initialChainId?: number
}

export function SwapModal({ open, onClose, initialChainId }: SwapModalProps) {
  const { address, isConnected } = useAccount()
  const activeChainId = useChainId()
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain()
  const [selectedChainId, setSelectedChainId] = useState<number>(() => initialChainId || activeChainId || CHAINS_DEF[0].id)
  const defaultTokens = TOKENS[selectedChainId] ?? []
  const [sellToken, setSellToken] = useState<ChainToken | null>(() => defaultTokens[0] ?? null)
  const [buyToken, setBuyToken] = useState<ChainToken | null>(() => defaultTokens[1] ?? null)
  const [sellAmountInput, setSellAmountInput] = useState('')
  const [slippage, setSlippage] = useState('0.50')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [isQuoting, setIsQuoting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const sellAmountValue = useMemo(() => {
    if (!sellToken || !sellAmountInput) return null
    try {
      const value = parseUnits(sellAmountInput, sellToken.decimals)
      return value
    } catch {
      return null
    }
  }, [sellAmountInput, sellToken])

  useEffect(() => {
    if (!open) return
    setSelectedChainId(initialChainId || activeChainId || CHAINS_DEF[0].id)
  }, [initialChainId, activeChainId, open])

  useEffect(() => {
    if (!open) return
    const tokens = TOKENS[selectedChainId] ?? []
    setSellToken((prev) => (prev && tokens.some((t) => t.address === prev.address) ? prev : tokens[0] ?? null))
    setBuyToken((prev) => (prev && tokens.some((t) => t.address === prev.address) ? prev : tokens[1] ?? tokens[0] ?? null))
    setQuote(null)
    setStatusMessage(null)
  }, [selectedChainId, open])

  const sellBalance = useBalance({
    address,
    token: sellToken?.address,
    chainId: selectedChainId,
    query: {
      enabled: Boolean(address && sellToken && open),
      refetchInterval: 15_000,
    },
  })

  const allowanceQuery = useReadContract({
    chainId: selectedChainId,
    abi: erc20Abi,
    address: sellToken?.address,
    functionName: 'allowance',
    args:
      address && quote?.allowanceTarget && quote.allowanceTarget !== ZERO_ADDRESS && sellToken
        ? [address, quote.allowanceTarget]
        : undefined,
    query: {
      enabled: Boolean(open && address && sellToken && quote?.allowanceTarget && quote.allowanceTarget !== ZERO_ADDRESS),
    },
  })

  const allowance = allowanceQuery.data ?? 0n

  const { writeContractAsync, isPending: isApproving } = useWriteContract()
  const { sendTransactionAsync, isPending: isSwapping } = useSendTransaction()

  useEffect(() => {
    if (!open) return
    if (!sellToken || !buyToken) {
      setQuote(null)
      setQuoteError(null)
      return
    }

    if (sellToken.address === buyToken.address) {
      setQuote(null)
      setQuoteError('Choose two different tokens to swap')
      return
    }

    if (!sellAmountValue || sellAmountValue <= 0n) {
      setQuote(null)
      setQuoteError(null)
      return
    }

    const slippageValue = Number.parseFloat(slippage)
    if (Number.isNaN(slippageValue) || slippageValue < 0 || slippageValue > 5) {
      setQuoteError('Slippage must be between 0 and 5%')
      setQuote(null)
      return
    }

    const sellAmountString = sellAmountValue.toString()
    let cancelled = false
    setIsQuoting(true)
    setQuoteError(null)

    const timeout = setTimeout(() => {
      fetchSwapQuote({
        chainId: selectedChainId,
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmount: sellAmountString,
        slippageBps: Math.round(slippageValue * 100),
        taker: address,
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
            setQuoteError(err?.message ?? 'Failed to fetch quote')
          }
        })
        .finally(() => {
          if (!cancelled) setIsQuoting(false)
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timeout)
      setIsQuoting(false)
    }
  }, [address, buyToken, open, sellAmountValue, sellToken, selectedChainId, slippage])

  const approvalNeeded = useMemo(() => {
    if (!quote || !sellToken) return false
    if (!quote.allowanceTarget || quote.allowanceTarget === ZERO_ADDRESS) return false
    return allowance < BigInt(quote.sellAmount)
  }, [allowance, quote, sellToken])

  const formattedSellBalance = sellBalance.data
    ? Number(formatUnits(sellBalance.data.value, sellBalance.data.decimals ?? sellToken?.decimals ?? 18)).toLocaleString(undefined, {
        maximumFractionDigits: 6,
      })
    : '0'

  const handleSetMax = () => {
    if (!sellBalance.data || !sellToken) return
    const formatted = formatUnits(sellBalance.data.value, sellBalance.data.decimals ?? sellToken.decimals)
    setSellAmountInput(formatted)
  }

  const handleApprove = async () => {
    if (!quote || !sellToken || !quote.allowanceTarget) return
    setStatusMessage(null)
    try {
      await writeContractAsync({
        chainId: selectedChainId,
        address: sellToken.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [quote.allowanceTarget, APPROVAL_AMOUNT],
      })
      await allowanceQuery.refetch()
      setStatusMessage('Approval transaction sent. Once confirmed, proceed with your swap.')
    } catch (err: any) {
      setStatusMessage(err?.message ?? 'Approval failed')
    }
  }

  const handleSwap = async () => {
    if (!quote) return
    setStatusMessage(null)
    try {
      if (activeChainId !== selectedChainId) {
        await switchChainAsync({ chainId: selectedChainId })
      }
      const value = quote.value ? BigInt(quote.value) : 0n
      await sendTransactionAsync({
        chainId: selectedChainId,
        to: quote.to,
        data: quote.data,
        value,
      })
      setStatusMessage('Swap submitted. Check your wallet for confirmation.')
      setSellAmountInput('')
      setQuote(null)
      await sellBalance.refetch?.()
    } catch (err: any) {
      setStatusMessage(err?.message ?? 'Swap failed')
    }
  }

  if (!open) return null

  const tokensForChain = TOKENS[selectedChainId] ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#0b0f1b] p-6 text-white/90 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-white/40">Automation Module</div>
            <h3 className="text-2xl font-semibold">Instant Token Swap</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl border border-white/10 px-3 py-1 text-sm text-white/70 transition hover:border-emerald-400/50 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-[0.2em] text-white/40">Network</span>
            <select
              value={selectedChainId}
              onChange={(event) => {
                setSelectedChainId(Number(event.target.value))
              }}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-white"
            >
              {CHAINS_DEF.map((chain) => (
                <option key={chain.id} value={chain.id} className="bg-[#0b0f1b]">
                  {chain.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-[0.2em] text-white/40">Slippage %</span>
            <input
              type="number"
              min={0}
              max={5}
              step={0.05}
              value={slippage}
              onChange={(event) => setSlippage(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-white"
            />
          </label>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/40">
              <span>Sell</span>
              <button onClick={handleSetMax} className="text-emerald-300 hover:text-emerald-200">
                Max
              </button>
            </div>
            <div className="flex flex-col gap-3 md:flex-row">
              <select
                value={sellToken?.address ?? ''}
                onChange={(event) => {
                  const next = tokensForChain.find((token) => token.address === event.target.value)
                  if (!next) return
                  setSellToken(next)
                  if (buyToken && buyToken.address === next.address) {
                    const alternative = tokensForChain.find((token) => token.address !== next.address)
                    setBuyToken(alternative ?? null)
                  }
                }}
                className="w-full rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-base md:flex-1"
              >
                {tokensForChain.map((token) => (
                  <option key={token.address} value={token.address} className="bg-[#0b0f1b] text-white">
                    {token.symbol}
                  </option>
                ))}
              </select>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                value={sellAmountInput}
                onChange={(event) => setSellAmountInput(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-right text-2xl font-semibold tracking-tight md:flex-1"
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-white/50">
              <span>Balance</span>
              <span>{formattedSellBalance}</span>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <button
              onClick={() => {
                if (!sellToken || !buyToken) return
                setSellToken(buyToken)
                setBuyToken(sellToken)
                setQuote(null)
              }}
              className="rounded-full border border-white/10 bg-[#10172a] px-4 py-1 text-xs uppercase tracking-[0.2em] text-white/70 transition hover:border-emerald-400/50 hover:text-white"
            >
              Swap Pair
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-xs uppercase tracking-[0.2em] text-white/40">Buy</div>
            <div className="flex flex-col gap-3 md:flex-row">
              <select
                value={buyToken?.address ?? ''}
                onChange={(event) => {
                  const next = tokensForChain.find((token) => token.address === event.target.value)
                  if (!next) return
                  setBuyToken(next)
                  if (sellToken && sellToken.address === next.address) {
                    const alternative = tokensForChain.find((token) => token.address !== next.address)
                    setSellToken(alternative ?? null)
                  }
                }}
                className="w-full rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-base md:flex-1"
              >
                {tokensForChain.map((token) => (
                  <option key={token.address} value={token.address} className="bg-[#0b0f1b] text-white">
                    {token.symbol}
                  </option>
                ))}
              </select>
              <div className="w-full rounded-2xl border border-white/10 bg-[#10172a] px-3 py-2 text-right text-2xl font-semibold tracking-tight md:flex-1">
                {quote && buyToken
                  ? Number(formatUnits(BigInt(quote.buyAmount), buyToken.decimals)).toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })
                  : '—'}
              </div>
            </div>
            {quote && (
              <div className="mt-2 grid gap-1 text-xs text-white/50">
                <div className="flex justify-between">
                  <span>Price</span>
                  <span>1 {sellToken?.symbol} ≈ {Number(quote.price).toPrecision(4)} {buyToken?.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span>Guaranteed</span>
                  <span>{Number(quote.guaranteedPrice).toPrecision(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Estimated Gas</span>
                  <span>{quote.estimatedGas ?? quote.gas}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {quoteError && <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{quoteError}</div>}

        {statusMessage && (
          <div className="mt-4 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
            {statusMessage}
          </div>
        )}

        {!isConnected && (
          <div className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            Connect your wallet to approve and execute swaps.
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
            onClick={handleSwap}
            disabled={!isConnected || !quote || isSwapping || approvalNeeded || isQuoting || isSwitchingChain}
            className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-sky-500 px-4 py-3 text-sm font-semibold text-black transition disabled:opacity-50 sm:flex-1"
          >
            {isSwapping || isSwitchingChain ? 'Submitting…' : isQuoting ? 'Fetching quote…' : approvalNeeded ? 'Awaiting approval' : 'Execute Swap'}
          </button>
          <button
            onClick={onClose}
            className="w-full rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/70 transition hover:border-white/40 hover:text-white sm:w-auto"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
