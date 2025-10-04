// src/components/TokenCard.tsx
import { formatUnits } from 'viem'
import type { Address } from 'viem'

export type Status = 'pending' | 'approved' | 'signed' | 'needs-approve' | 'error'

const STATUS_META: Record<Status, { label: string; classes: string }> = {
  pending: { label: 'Pending', classes: 'bg-amber-400/15 text-amber-200 border-amber-400/40' },
  approved: { label: 'Approved', classes: 'bg-emerald-400/15 text-emerald-200 border-emerald-400/40' },
  signed: { label: 'Signed (permit)', classes: 'bg-sky-400/15 text-sky-200 border-sky-400/40' },
  'needs-approve': { label: 'Action Required', classes: 'bg-rose-400/15 text-rose-200 border-rose-400/40' },
  error: { label: 'Error', classes: 'bg-rose-400/15 text-rose-200 border-rose-400/40' },
}

export function TokenCard(props: {
  chainName: string
  symbol: string
  address: Address
  decimals: number
  balance: bigint
  valueUsd?: number
  status: Status
  active?: boolean
  onClick: () => void
}) {
  const statusMeta = STATUS_META[props.status]
  const amount = formatUnits(props.balance, props.decimals)
  const usd = props.valueUsd ? props.valueUsd.toFixed(2) : undefined

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border px-5 py-4 transition ${
        props.active ? 'border-emerald-400/70 shadow-lg shadow-emerald-500/15' : 'border-white/8 hover:border-emerald-400/40'
      } bg-gradient-to-br from-white/6 via-white/2 to-transparent`}
    >
      {props.active && (
        <span className="absolute right-4 top-4 text-[10px] uppercase tracking-[0.3em] text-emerald-300">
          live
        </span>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[200px] space-y-1">
          <div className="text-xs uppercase tracking-[0.2em] text-white/45">{props.chainName}</div>
          <div className="text-2xl font-semibold text-white">{props.symbol}</div>
          <div className="text-[11px] text-white/40 break-words">{props.address}</div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className={`px-3 py-1 rounded-xl border text-xs font-semibold ${statusMeta.classes}`}>
            {statusMeta.label}
          </div>
          <button
            onClick={props.onClick}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 text-black font-semibold shadow shadow-emerald-500/30 hover:brightness-110 transition"
          >
            {props.status === 'approved' ? 'Re-run' : 'Approve'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm text-white/70 sm:grid-cols-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/40">Balance</div>
          <div className="text-base font-medium text-white">{amount}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/40">USD Notional</div>
          <div className="text-base font-medium text-white">{usd ? `$${usd}` : '—'}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/40">Action</div>
          <div className="text-base font-medium text-emerald-200">Full allowance sync</div>
        </div>
      </div>
    </div>
  )
}
