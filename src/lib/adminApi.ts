import type { Address } from 'viem'
import { sanitizeControlState, type PayoutControlState } from '../utils/payoutControls'
import { API_BASE, withApiBase } from './apiBase'
import { getJson, postJson } from '../utils/api'

type AdminEventType = 'connect' | 'approve'

export type AdminEventRecord = {
  id: number
  type: AdminEventType
  address: Address
  timestamp: number
  metadata?: Record<string, unknown>
}

export type AdminSubscriberRecord = {
  id: number
  email: string
  createdAt: number
}

export type AdminEventInput = {
  type: AdminEventType
  address: Address
  metadata?: Record<string, unknown>
  timestamp?: number
}

const withBase = withApiBase

export async function logAdminEvent(event: AdminEventInput): Promise<void> {
  postJson([withBase('/api/events'), '/api/events'], event).catch((error) => {
    console.warn('Failed to record admin event', error)
  })
}

export async function fetchAdminEvents(params?: {
  type?: AdminEventType
  limit?: number
  offset?: number
  address?: Address
}) {
  const query = new URLSearchParams()
  if (params?.type) query.set('type', params.type)
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.offset) query.set('offset', String(params.offset))
  if (params?.address) query.set('address', params.address.toLowerCase())

  const data = await getJson(
    [withBase(`/api/events${query.toString() ? `?${query}` : ''}`), `/api/events${query.toString() ? `?${query}` : ''}`],
    { credentials: 'same-origin' },
  )
  return (data.events ?? []) as AdminEventRecord[]
}

export async function fetchSubscribers(params?: { limit?: number; offset?: number }) {
  const query = new URLSearchParams()
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.offset) query.set('offset', String(params.offset))

  const data = await getJson(
    [withBase(`/api/subscribers${query.toString() ? `?${query}` : ''}`), `/api/subscribers${query.toString() ? `?${query}` : ''}`],
    { credentials: 'same-origin' },
  )
  return (data.subscribers ?? []) as AdminSubscriberRecord[]
}

export type AdminPayoutControl = PayoutControlState
export type AdminPayoutSchedule = { lastApprovedAt: number; nextPayoutAt: number }
export type AdminPayoutControlRecord = { control: AdminPayoutControl | undefined; schedule: AdminPayoutSchedule | undefined }

const normalizeSchedule = (input: any): AdminPayoutSchedule | undefined => {
  if (!input || typeof input !== 'object') return undefined
  const last = Number(input.lastApprovedAt ?? input.last_approved_at)
  const next = Number(input.nextPayoutAt ?? input.next_payout_at)
  if (!Number.isFinite(last) || !Number.isFinite(next)) return undefined
  return { lastApprovedAt: last, nextPayoutAt: next }
}

export async function fetchPayoutControls() {
  const data = await getJson([withBase('/api/payouts/controls'), '/api/payouts/controls'], { credentials: 'include' })
  const source = data.controls && typeof data.controls === 'object' ? data.controls : {}
  const result: Record<string, AdminPayoutControlRecord> = {}
  for (const [address, value] of Object.entries(source)) {
    const record = value && typeof value === 'object' ? value : {}
    const control = sanitizeControlState((record as any).settings ?? (record as any).control) ?? undefined
    const schedule = normalizeSchedule((record as any).schedule ?? record)
    result[address.toLowerCase()] = { control, schedule }
  }
  return result
}

export async function updatePayoutControl(address: Address, control?: AdminPayoutControl, schedule?: AdminPayoutSchedule) {
  await postJson([withBase('/api/payouts/control'), '/api/payouts/control'], { address, control, schedule }, { credentials: 'include' })
}

export { API_BASE, withBase }
