import type { Address } from 'viem'
import { withApiBase } from './apiBase'
import { sanitizeControlState, type PayoutControlState } from '../utils/payoutControls'

const withBase = withApiBase

export type RemotePayoutControl = PayoutControlState

export async function fetchPayoutControl(address: Address): Promise<RemotePayoutControl | null> {
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
      const cleaned = sanitizeControlState(data?.control)
      return cleaned ?? null
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(error?.message ?? String(error))
    }
  }
  if (lastError) throw lastError
  return null
}
