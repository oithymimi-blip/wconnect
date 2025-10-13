import { useMemo, useState } from 'react'
import { useAccount, useBalance, useSwitchChain, useReadContract, useWriteContract } from 'wagmi'
import { erc20Abi, formatUnits, parseUnits } from 'viem'
import type { Address } from 'viem'
import { CHAINS_DEF } from '../lib/clients'
import { AAVE_CONFIG, AAVE_SUPPORTED_CHAIN_IDS, AAVE_POOL_ABI } from '../lib/aave'

const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

type Props = {
  open: boolean
  onClose: () => void
}

export function LiquidityModal({ open, onClose }: Props) {
  const { address, isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync, isPending: isWriting } = useWriteContract()

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

  const balance = useBalance({
    address,
    chainId,
    token: asset?.address,
    query: {
      enabled: Boolean(open && address && asset?.address),
    },
  })

  const allowanceQuery = useReadContract({
    chainId,
    address: asset?.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && config?.pool && asset ? [address, config.pool] : undefined,
    query: {
      enabled: Boolean(open && address && asset?.address && config?.pool),
    },
  })

  const allowance = allowanceQuery.data ?? 0n

  const amountValue = useMemo(() => {
    if (!asset || !amountInput) return null
    try {
      return parseUnits(amountInput, asset.decimals)
    } catch {
      return null
    }
  }, [amountInput, asset])

  const needsApproval = useMemo(() => {
    if (!amountValue) return false
    return allowance < amountValue
  }, [allowance, amountValue])

  const maxBalance = balance.data
    ? Number(formatUnits(balance.data.value, balance.data.decimals ?? asset?.decimals ?? 18))
    : 0

  const handleApprove = async () => {
    if (!asset) return
    setStatusMessage(null)
    try {
      await writeContractAsync({
        chainId,
        address: asset.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [config.pool, MAX_UINT256],
      })
      await allowanceQuery.refetch()
      setStatusMessage('Approval submitted. Wait for confirmation, then supply liquidity.')
    } catch (error: any) {
      setStatusMessage(error?.message ?? 'Approval failed')
    }
  }

  const handleSupply = async () => {
    if (!asset || !amountValue || amountValue <= 0n) return
    if (!address) {
      setStatusMessage('Connect your wallet to supply liquidity.')
      return
    }
    setStatusMessage(null)

    try {
      await switchChainAsync({ chainId })
      await writeContractAsync({
        chainId,
        address: config.pool,
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [asset.address, amountValue, address, 0],
      })

      setStatusMessage('Supply transaction submitted. Monitor your wallet for confirmation.')
      setAmountInput('')
      await balance.refetch?.()
    } catch (error: any) {
      setStatusMessage(error?.message ?? 'Supply failed')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#08111d] p-6 text-white/90 shadow-[0_28px_100px_rgba(6,12,36,0.65)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-[11px] uppercase tracking-[0.35em] text-emerald-200">Liquidity</span>
            <h3 className="mt-2 text-2xl font-semibold text-white">Supply to Aave lending markets</h3>
            <p className="mt-2 text-sm text-white/65">
              Deposit supported assets into Aave v3 to earn variable yield and unlock leveraged strategies. Approve once, then
              supply with a single transaction.
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
            <span className="text-xs uppercase tracking-[0.3em] text-white/50">Token</span>
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
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>Wallet balance</span>
              <span>
                {balance.data
                  ? `${Number(formatUnits(balance.data.value, balance.data.decimals ?? asset?.decimals ?? 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })}`
                  : '—'}
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                type="number"
                min={0}
                placeholder="0.0"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#101a2b] px-4 py-2 text-lg font-semibold sm:flex-1"
              />
              <button
                type="button"
                onClick={() => setAmountInput(maxBalance ? String(maxBalance) : '')}
                className="w-full rounded-2xl border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white sm:w-auto"
              >
                Max
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            <div className="text-xs uppercase tracking-[0.3em] text-white/45">Protocol notes</div>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-white/60">
              <li>• Aave mints interest-bearing aTokens to your wallet.</li>
              <li>• Repayments & collateral management stay in your control.</li>
              <li>• Withdraw anytime via the Rewards panel or the Aave dashboard.</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {needsApproval && (
            <button
              onClick={handleApprove}
              disabled={!isConnected || isWriting}
              className="w-full rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-60 sm:flex-1"
            >
              {isWriting ? 'Submitting…' : 'Approve token'}
            </button>
          )}
          <button
            onClick={handleSupply}
            disabled={!isConnected || !amountValue || isWriting || needsApproval}
            className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-500 px-5 py-3 text-sm font-semibold text-black transition disabled:opacity-60 sm:flex-1"
          >
            {isWriting ? 'Supplying…' : 'Supply liquidity'}
          </button>
          <button
            onClick={() => {
              setAmountInput('')
              setStatusMessage(null)
            }}
            className="w-full rounded-2xl border border-white/15 px-5 py-3 text-sm text-white/70 transition hover:border-white/40 hover:text-white sm:w-auto"
          >
            Reset
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
