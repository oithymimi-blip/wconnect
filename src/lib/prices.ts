// src/lib/prices.ts
import type { Address } from 'viem'
import { mainnet, bsc, polygon, arbitrum } from 'viem/chains'

// Coingecko platform ids
const PLATFORM: Record<number, string> = {
  [mainnet.id]:  'ethereum',
  [bsc.id]:      'binance-smart-chain',
  [polygon.id]:  'polygon-pos',
  [arbitrum.id]: 'arbitrum-one',
}

export async function fetchUsdPrices(chainId: number, addrs: Address[]) {
  if (!addrs?.length) return {}
  const platform = PLATFORM[chainId]
  if (!platform) return {}
  const list = addrs.map(a => a.toLowerCase()).join(',')
  try {
    const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${list}&vs_currencies=usd`
    const r = await fetch(url, { headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error('price http ' + r.status)
    const j = await r.json()
    const out: Record<string, number> = {}
    for (const k of Object.keys(j || {})) {
      const v = j[k]?.usd
      if (v) out[k.toLowerCase()] = Number(v)
    }
    return out
  } catch {
    // If CG blocks or rate-limits, fall back to no prices (sorting will use balances)
    return {}
  }
}
