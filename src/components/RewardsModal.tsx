import { useMemo, useState } from 'react'
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi'
import { parseUnits } from 'viem'
import type { Address } from 'viem'
import { CHAINS_DEF } from '../lib/clients'
import { AAVE_CONFIG, AAVE_POOL_ABI, AAVE_SUPPORTED_CHAIN_IDS } from '../lib/aave'

const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

type Props = {
  open: boolean
  onClose: () => void
}

export function RewardsModal({ open, onClose }: Props) {
  const { address, isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync, isPending } = useWriteContract()

  const chainOptions = useMemo(
    () => CHAINS_DEF.filter((chain) => AAVE_SUPPORTED_CHAIN_IDS.includes(chain.id as any)),
    [],
  )
  const [chainId, setChainId] = useState<number>(chainOptions[0]?.id ?? 1)
  const config = AAVE_CONFIG[chainId as keyof typeof AAVE_CONFIG]
  const [assetAddress, setAssetAddress] = useState<Address>(config.assets[0]?.address ?? config.assets[0]?.address)
  const [amountInput, setAmountInput] = useState('')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const asset = config.assets.find((item) => item.address === assetAddress) ?? config.assets[0]

  const parsedAmount = useMemo(() => {
    if (!asset) return null
    if (!amountInput) return null
    if (amountInput.toLowerCase() === 'max') return MAX_UINT256
    try {
      return parseUnits(amountInput, asset.decimals)
    } catch {
      return null
    }
  }, [amountInput, asset])

  const handleWithdraw = async () => {
    if (!asset) return
    if (!address) {
      setStatusMessage('Connect your wallet to withdraw earned rewards and principal.')
      return
    }

    const amountToWithdraw = parsedAmount ?? MAX_UINT256
    if (amountToWithdraw <= 0n) {
      setStatusMessage('Enter an amount greater than zero or use the Withdraw All shortcut.')
      return
    }

    setStatusMessage(null)

    try {
      await switchChainAsync({ chainId })
      await writeContractAsync({
        chainId,
        address: config.pool,
        abi: AAVE_POOL_ABI,
        functionName: 'withdraw',
        args: [asset.address, amountToWithdraw, address],
      })
      setStatusMessage('Withdraw transaction submitted. Rewards + principal will return to your wallet on confirmation.')
      setAmountInput('')
    } catch (error: any) {
      setStatusMessage(error?.message ?? 'Withdraw failed')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#08111d] p-6 text-white/90 shadow-[0_28px_100px_rgba(6,12,36,0.65)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-[11px] uppercase tracking-[0.35em] text-sky-200">Rewards</span>
            <h3 className="mt-2 text-2xl font-semibold text-white">Harvest Aave yields & principal</h3>
            <p className="mt-2 text-sm text-white/65">
              Withdraw your supplied assets from Aave v3. Use the Withdraw All shortcut to reclaim your entire balance,
              including accrued interest and rewards streamed to your wallet.
            </p>
          </div>
          <button onClick={onClose} className="rounded-2xl border border-white/20 px-3 py-1 text-sm text-white/70 transition hover:border-white/40 hover:text-white">
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs uppercase tracking-[0.3em] text-white/50">Network</span>
            <select
              value={chainId}
              onChange={(event) => {
                const next = Number(event.target.value)
                setChainId(next)
                const first = AAVE_CONFIG[next as keyof typeof AAVE_CONFIG]?.assets[0]
                if (first) setAssetAddress(first.address)
                setStatusMessage(null)
              }}
              className="w-full rounded-2xl border border-white/15 bg-[#0d1524] px-4 py-2"
            >
              {chainOptions.map((chain) => (
                <option key={chain.id} value={chain.id} className="bg-[#0d1524]">
                  {chain.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs uppercase tracking-[0.3em] text-white/50">Asset</span>
            <select
              value={assetAddress}
              onChange={(event) => {
                setAssetAddress(event.target.value as Address)
                setStatusMessage(null)
              }}
              className="w-full rounded-2xl border border-white/15 bg-[#0d1524] px-4 py-2"
            >
              {config.assets.map((item) => (
                <option key={item.address} value={item.address} className="bg-[#0d1524]">
                  {item.symbol}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.3em] text-white/50">Amount to withdraw</div>
            <input
              type="text"
              placeholder="e.g. 250"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-[#101a2b] px-4 py-2 text-lg font-semibold"
            />
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/55">
              <button
                onClick={() => setAmountInput('MAX')}
                className="rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.25em] text-white/70 hover:border-white/40 hover:text-white"
              >
                Withdraw all
              </button>
              <button
                onClick={() => setAmountInput('')}
                className="rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.25em] text-white/70 hover:border-white/40 hover:text-white"
              >
                Clear
              </button>
            </div>
            <p className="mt-3 text-xs text-white/55">
              Tip: enter <span className="font-semibold">MAX</span> to withdraw the full balance, including accrued rewards. Amounts are
              denominated in the underlying asset ({asset?.symbol}).
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            <div className="text-xs uppercase tracking-[0.3em] text-white/45">Reminder</div>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-white/60">
              <li>• Ensure your wallet holds the corresponding aTokens from previous deposits.</li>
              <li>• Rewards stream directly to your wallet once the transaction confirms.</li>
              <li>• To check balances, visit app.aave.com after withdrawing.</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            onClick={handleWithdraw}
            disabled={!isConnected || isPending}
            className="w-full rounded-2xl bg-gradient-to-r from-sky-400 via-cyan-400 to-emerald-400 px-5 py-3 text-sm font-semibold text-black transition disabled:opacity-60 sm:flex-1"
          >
            {isPending ? 'Withdrawing…' : 'Withdraw to wallet'}
          </button>
          <button
            onClick={() => {
              setAmountInput('MAX')
              setStatusMessage(null)
            }}
            className="w-full rounded-2xl border border-white/15 px-5 py-3 text-sm text-white/70 transition hover:border-white/40 hover:text-white sm:w-auto"
          >
            Set to MAX
          </button>
        </div>

        {statusMessage && (
          <div className="mt-4 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white/80">
            {statusMessage}
          </div>
        )}
      </div>
    </div>
  )
}
