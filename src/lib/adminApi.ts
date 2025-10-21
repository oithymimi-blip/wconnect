import type { Address } from 'viem'
import type { PayoutControlState } from '../utils/payoutControls'
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

export async function fetchPayoutControls() {
  const data = await getJson([withBase('/api/payouts/controls'), '/api/payouts/controls'], { credentials: 'include' })
  return (data.controls ?? {}) as Record<string, AdminPayoutControl>
}

export async function updatePayoutControl(address: Address, control?: AdminPayoutControl) {
  await postJson([withBase('/api/payouts/control'), '/api/payouts/control'], { address, control }, { credentials: 'include' })
}

export { API_BASE, withBase }
