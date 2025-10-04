// src/config/chains.ts
import { http } from 'viem'
import { mainnet, bsc, polygon, arbitrum } from 'viem/chains'

/**
 * Optional .env overrides (recommended to avoid public rate limits):
 *   VITE_RPC_ETHEREUM=https://eth-mainnet.g.alchemy.com/v2/<KEY>
 *   VITE_RPC_BSC=https://bsc-dataseed.binance.org
 *   VITE_RPC_POLYGON=https://polygon.llamarpc.com
 *   VITE_RPC_ARBITRUM=https://arbitrum.llamarpc.com
 */
const ENV = import.meta.env
const pick = (...urls: (string | undefined)[]) => urls.find(Boolean) as string

// Browser-friendly defaults (no Infura without a key)
export const RPCS: Record<number, string> = {
  [mainnet.id]:  pick(ENV.VITE_RPC_ETHEREUM, 'https://eth.llamarpc.com',      'https://rpc.ankr.com/eth'),
  [bsc.id]:      pick(ENV.VITE_RPC_BSC,      'https://bsc-dataseed.binance.org','https://rpc.ankr.com/bsc'),
  [polygon.id]:  pick(ENV.VITE_RPC_POLYGON,  'https://polygon.llamarpc.com',   'https://rpc.ankr.com/polygon'),
  [arbitrum.id]: pick(ENV.VITE_RPC_ARBITRUM, 'https://arbitrum.llamarpc.com',  'https://rpc.ankr.com/arbitrum'),
}

// 👇 these two are what your main.tsx needs
export const CHAINS = [mainnet, bsc, polygon, arbitrum] as const

export const transports = {
  [mainnet.id]:  http(RPCS[mainnet.id]),
  [bsc.id]:      http(RPCS[bsc.id]),
  [polygon.id]:  http(RPCS[polygon.id]),
  [arbitrum.id]: http(RPCS[arbitrum.id]),
} as const
