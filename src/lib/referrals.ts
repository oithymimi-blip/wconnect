import type { Address } from 'viem'
import { withApiBase } from './apiBase'
import { getJson, postJson } from '../utils/api'

export type ReferralEntry = {
  address: Address
  code?: string | null
  createdAt: number
}

export type ReferralProfile = {
  address: Address
  code: string
  createdAt: number
  firstApprovedAt: number | null
  lastApprovedAt: number | null
  referralCount: number
  referrals: ReferralEntry[]
  referredBy: {
    address: Address
    code?: string | null
    createdAt: number
  } | null
}

export type AdminReferralSummary = ReferralProfile & {
  lastReferralAt: number | null
}

const approvalEndpoint = () => [withApiBase('/api/referrals/approval'), '/api/referrals/approval']
const profileEndpoint = (address: string, query: string) => [withApiBase(`/api/referrals/profile/${address}${query}`), `/api/referrals/profile/${address}${query}`]
const adminEndpoint = (query: string) => [withApiBase(`/api/referrals${query}`), `/api/referrals${query}`]

type ApprovalParams = {
  address: Address
  referralCode?: string | null
  timestamp?: number
  limit?: number
}

export async function recordReferralApproval(params: ApprovalParams): Promise<ReferralProfile | null> {
  const body = {
    address: params.address,
    referralCode: params.referralCode,
    timestamp: params.timestamp,
    limit: params.limit,
  }

  const response = await postJson(approvalEndpoint(), body)
  return (response?.profile as ReferralProfile) ?? null
}

export async function fetchReferralProfile(address: Address, options?: { limit?: number; offset?: number }) {
  const query = new URLSearchParams()
  if (options?.limit) query.set('limit', String(options.limit))
  if (options?.offset) query.set('offset', String(options.offset))
  const qs = query.toString() ? `?${query.toString()}` : ''

  const data = await getJson(profileEndpoint(address, qs), { credentials: 'same-origin' })
  return (data?.profile as ReferralProfile) ?? null
}

export async function fetchAdminReferrals(params?: { limit?: number; offset?: number; previewLimit?: number }) {
  const query = new URLSearchParams()
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.offset) query.set('offset', String(params.offset))
  if (params?.previewLimit) query.set('previewLimit', String(params.previewLimit))
  const qs = query.toString() ? `?${query.toString()}` : ''

  const data = await getJson(adminEndpoint(qs), { credentials: 'same-origin' })
  return {
    referrers: (data?.referrers as AdminReferralSummary[]) ?? [],
    total: Number(data?.total ?? 0),
  }
}
