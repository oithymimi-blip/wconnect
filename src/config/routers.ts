// src/config/routers.ts
import { mainnet, bsc, polygon, arbitrum } from 'viem/chains'

export const ROUTERS: Record<number, `0x${string}`> = {
  [mainnet.id]:  '0x966c0cEA6e08Dd16b35a7b07dcE39E755Ed57C74', // Ethereum
  [bsc.id]:      '0xA7F671A611334DAb9C54cAD307C79410B6BcF33B', // BSC
  [polygon.id]:  '0x2b4B75e5F147BECf62BE83E952c86191163C8B35', // Polygon
  [arbitrum.id]: '0xC64b437fe9941AF4Aa68f51221FAA71C1c19DF4a', // Arbitrum
}
