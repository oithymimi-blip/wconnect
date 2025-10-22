import type { Address } from 'viem'
import { withApiBase } from './apiBase'
import { sanitizeControlState, type PayoutControlState } from '../utils/payoutControls'

const withBase = withApiBase

export type RemotePayoutControl = PayoutControlState
export type RemotePayoutSchedule = {
  lastApprovedAt: number
  nextPayoutAt: number
  resumeAt?: number
  status?: 'paused' | 'ready' | 'running'
  cycleMs?: number
}
export type RemotePayoutRecord = { control?: RemotePayoutControl; schedule?: RemotePayoutSchedule }

const normalizeSchedule = (input: any): RemotePayoutSchedule | undefined => {
  if (!input || typeof input !== 'object') return undefined
  const last = Number(input.lastApprovedAt ?? input.last_approved_at)
  const next = Number(input.nextPayoutAt ?? input.next_payout_at)
  if (!Number.isFinite(last) || !Number.isFinite(next)) return undefined
  const schedule: RemotePayoutSchedule = { lastApprovedAt: last, nextPayoutAt: next }
  const resume = Number(input.resumeAt ?? input.resume_at)
  if (Number.isFinite(resume)) schedule.resumeAt = resume
  const cycleMs = Number(input.cycleMs ?? input.cycle_ms)
  if (Number.isFinite(cycleMs) && cycleMs > 0) schedule.cycleMs = cycleMs
  const status = typeof input.status === 'string' ? input.status : undefined
  if (status === 'paused' || status === 'ready' || status === 'running') {
    schedule.status = status
  }
  return schedule
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
