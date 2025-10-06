import { useEffect, useMemo, useState } from 'react'
import { useAccount, useBalance, useChainId, useSendTransaction, useSwitchChain } from 'wagmi'
import { encodeFunctionData, parseUnits, type Address } from 'viem'
import type { ModulePreview } from '../hooks/useAutomationPreviews'

const LIDO_STAKING_ADDRESS = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84' as const satisfies Address
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const satisfies Address
const ETHEREUM_MAINNET_ID = 1

const LIDO_STAKING_ABI = [
  {
    name: 'submit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: '_referral', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

type Props = {
  open: boolean
  onClose: () => void
  preview?: ModulePreview
}

function trimAmount(value: number) {
  if (value <= 0) return ''
  if (value >= 1) return value.toFixed(4).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
  return value.toPrecision(4)
}

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value)
}

export function StakingModal({ open, onClose, preview }: Props) {
  const { address, isConnected } = useAccount()
  const activeChainId = useChainId()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
  const { sendTransactionAsync, isPending: isSubmitting } = useSendTransaction()

  const [amountInput, setAmountInput] = useState('')
  const [referralInput, setReferralInput] = useState('')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setAmountInput('')
    setReferralInput('')
    setStatusMessage(null)
    setTxHash(null)
  }, [open])

  const balance = useBalance({
    address,
    unit: 'ether',
    query: {
      enabled: Boolean(open && address),
      refetchInterval: open ? 20_000 : false,
    },
  })

  const amountValue = useMemo(() => {
    if (!amountInput) return null
    try {
      const parsed = parseUnits(amountInput, 18)
      return parsed > 0n ? parsed : null
    } catch {
      return null
    }
  }, [amountInput])

  const referralAddress = useMemo(() => {
    if (!referralInput) return ZERO_ADDRESS
    const trimmed = referralInput.trim()
    return isAddress(trimmed) ? (trimmed as Address) : null
  }, [referralInput])

  const formattedBalance = balance.data ? Number(balance.data.formatted) : 0
  const estimatedStEth = amountInput && Number(amountInput) > 0 ? `${amountInput} stETH (≈)` : '—'

  const canStake = Boolean(
    isConnected &&
      amountValue &&
      amountValue > 0n &&
      referralAddress !== null &&
      !isSubmitting &&
      !isSwitching,
  )

  const needsChainSwitch = isConnected && activeChainId !== ETHEREUM_MAINNET_ID

  const handleSetMax = () => {
    if (!formattedBalance || formattedBalance <= 0) return
    // leave a small buffer for gas
    const safe = Math.max(0, formattedBalance - 0.003)
    setAmountInput(trimAmount(safe))
  }

  const handleStake = async () => {
    if (!address) {
      setStatusMessage('Connect your wallet to stake with Lido.')
      return
    }
    if (!amountValue || amountValue <= 0n) {
      setStatusMessage('Enter an amount of ETH to stake.')
      return
    }
    if (!referralAddress) {
      setStatusMessage('Referral must be a valid address (or leave blank).')
      return
    }

    setStatusMessage(null)
    setTxHash(null)

    try {
      if (activeChainId !== ETHEREUM_MAINNET_ID) {
        await switchChainAsync({ chainId: ETHEREUM_MAINNET_ID })
      }

      const data = encodeFunctionData({
        abi: LIDO_STAKING_ABI,
        functionName: 'submit',
        args: [referralAddress],
      })

      const hash = await sendTransactionAsync({
        chainId: ETHEREUM_MAINNET_ID,
        to: LIDO_STAKING_ADDRESS,
        data,
        value: amountValue,
      })

      setTxHash(hash)
      setStatusMessage('Stake submitted. stETH will appear after the transaction confirms.')
      setAmountInput('')
      await balance.refetch?.()
    } catch (error: any) {
      setStatusMessage(error?.message ?? 'Stake failed')
    }
  }

  if (!open) return null

  const aprSummary = preview && !preview.loading ? preview.status : 'Live APR sync'
  const aprDetail = preview && !preview.loading ? preview.detail : undefined

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl space-y-6 rounded-3xl border border-white/10 bg-[#08111d] p-6 text-white/90 shadow-[0_28px_100px_rgba(6,12,36,0.65)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <span className="text-[11px] uppercase tracking-[0.35em] text-emerald-200">Staking</span>
            <h3 className="text-2xl font-semibold text-white">Stake ETH for stETH via Lido</h3>
            <p className="text-sm text-white/65">
              Route deposits directly to the Lido staking contract. Funds remain in your wallet as stETH and accrue yield
              continuously.
            </p>
          </div>
          <button
            onClick={onClose}
            className="self-start rounded-2xl border border-white/20 px-3 py-1.5 text-sm text-white/70 transition hover:border-white/40 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.3em] text-white/50">Network</div>
            <div className="mt-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Ethereum Mainnet</div>
              {needsChainSwitch && (
                <span className="rounded-full border border-amber-400/50 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-200">
                  Switch needed
                </span>
              )}
            </div>
            <div className="mt-3 text-xs text-white/55">
              Deposits require ETH and will mint stETH at the current beacon chain exchange rate.
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            <div className="text-xs uppercase tracking-[0.3em] text-white/45">Live metrics</div>
            <div className="mt-2 text-white">
              {aprSummary}
              {aprDetail && <span className="block text-xs text-white/55">{aprDetail}</span>}
            </div>
            <ul className="mt-3 space-y-1 text-xs leading-relaxed text-white/55">
              <li>• stETH is liquid and can be used across DeFi.</li>
              <li>• Unstaking requires a withdrawal request via Lido.</li>
              <li>• Gas usage averages 120k–150k units.</li>
            </ul>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between text-xs text-white/55">
              <span>Wallet balance</span>
              <button onClick={handleSetMax} className="text-emerald-300 transition hover:text-emerald-200">
                Max
              </button>
            </div>
            <div className="mt-2 text-lg font-semibold text-white">
              {formattedBalance ? `${formattedBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH` : '—'}
            </div>
            <div className="mt-4 space-y-3">
              <label className="text-xs text-white/60">Stake amount (ETH)</label>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.0"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                className="w-full rounded-2xl border border-white/15 bg-[#101a2b] px-4 py-2 text-lg font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              />
            </div>
            <div className="mt-3 space-y-2">
              <label className="text-xs text-white/60">Referral address (optional)</label>
              <input
                type="text"
                placeholder="0x0000…"
                value={referralInput}
                onChange={(event) => setReferralInput(event.target.value)}
                className="w-full rounded-2xl border border-white/15 bg-[#101a2b] px-4 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              />
              {referralInput && referralAddress === null && (
                <div className="text-[11px] text-rose-300">Enter a valid Ethereum address or leave empty.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            <div className="text-xs uppercase tracking-[0.3em] text-white/45">Stake summary</div>
            <div className="mt-3 space-y-2 text-xs text-white/60">
              <div className="flex items-center justify-between">
                <span>Expected mint</span>
                <span className="font-semibold text-white/80">{estimatedStEth}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Gas network</span>
                <span>Ethereum Mainnet</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Referral</span>
                <span>{referralAddress && referralAddress !== ZERO_ADDRESS ? referralAddress : 'None'}</span>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[11px] text-white/55">
              You will receive stETH in your wallet. To exit, submit a withdrawal request on stake.lido.fi or swap stETH for
              ETH using the Swap module.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleStake}
            disabled={!canStake}
            className="rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-500 px-5 py-3 text-sm font-semibold text-black transition disabled:opacity-60"
          >
            {isSubmitting || isSwitching ? 'Submitting…' : 'Stake with Lido'}
          </button>
          <button
            onClick={() => {
              setAmountInput('')
              setReferralInput('')
              setStatusMessage(null)
            }}
            className="rounded-2xl border border-white/15 px-5 py-3 text-sm text-white/70 transition hover:border-white/40 hover:text-white"
          >
            Reset
          </button>
          {txHash && (
            <a
              href={`https://etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl border border-sky-400/50 bg-sky-500/10 px-4 py-3 text-sm text-sky-100 transition hover:border-sky-400 hover:text-sky-50"
            >
              View on Etherscan
            </a>
          )}
        </div>

        {statusMessage && (
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white/80">{statusMessage}</div>
        )}
      </div>
    </div>
  )
}

export default StakingModal
