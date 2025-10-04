// src/lib/clients.ts
import { createPublicClient, http, type PublicClient } from 'viem'
import { mainnet, bsc, polygon, arbitrum } from 'viem/chains'
import { RPCS } from '../config/chains'

export const CHAINS_DEF = [mainnet, bsc, polygon, arbitrum] as const

export const PUBLIC: Record<number, PublicClient> = Object.fromEntries(
  CHAINS_DEF.map((c) => [
    c.id,
    createPublicClient({
      chain: c,
      transport: http(RPCS[c.id]), // always our curated/ENV endpoint
    }),
  ])
) as Record<number, PublicClient>

export const CHAIN_NAME: Record<number, string> = Object.fromEntries(
  CHAINS_DEF.map((c) => [c.id, c.name])
) as Record<number, string>
