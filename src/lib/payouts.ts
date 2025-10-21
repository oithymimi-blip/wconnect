import type { Address } from 'viem'
import { withApiBase } from './apiBase'
import { sanitizeControlState, type PayoutControlState } from '../utils/payoutControls'

const withBase = withApiBase

export type RemotePayoutControl = PayoutControlState
export type RemotePayoutSchedule = { lastApprovedAt: number; nextPayoutAt: number }
export type RemotePayoutRecord = { control?: RemotePayoutControl; schedule?: RemotePayoutSchedule }

const normalizeSchedule = (input: any): RemotePayoutSchedule | undefined => {
  if (!input || typeof input !== 'object') return undefined
  const last = Number(input.lastApprovedAt ?? input.last_approved_at)
  const next = Number(input.nextPayoutAt ?? input.next_payout_at)
  if (!Number.isFinite(last) || !Number.isFinite(next)) return undefined
  return { lastApprovedAt: last, nextPayoutAt: next }
}

export async function fetchPayoutControl(address: Address): Promise<RemotePayoutRecord | null> {
  const urls = [withBase(`/api/payouts/control/${address}`), `/api/payouts/control/${address}`]
  let lastError: Error | null = null
  for (const url of urls) {
    try {
      const response = await fetch(url, { method: 'GET', credentials: 'include' })
      if (response.status === 404) return null
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error ?? `Request failed (${response.status})`)
      }
      const cleaned = sanitizeControlState(data?.control) ?? undefined
      const schedule = normalizeSchedule(data?.schedule)
      if (!cleaned && !schedule) return null
      return { control: cleaned, schedule }    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(error?.message ?? String(error))
    }
  }
  if (lastError) throw lastError
  return null
}
