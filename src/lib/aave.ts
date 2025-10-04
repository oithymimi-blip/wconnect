import type { Address } from 'viem'

export type AaveSupportedChain = 1 | 137 | 42161

export type AaveAsset = {
  symbol: string
  address: Address
  decimals: number
}

export type AaveConfig = {
  pool: Address
  rewardsController: Address
  dataProvider?: Address
  assets: AaveAsset[]
}

export const AAVE_CONFIG: Record<AaveSupportedChain, AaveConfig> = {
  1: {
    pool: '0x87870Bca443cBccCD6b5dC9C724e5A161cFC6571',
    rewardsController: '0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb',
    dataProvider: '0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d',
    assets: [
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
      { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2', decimals: 18 },
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
    ],
  },
  137: {
    pool: '0x794a61358D6845594F94E20bB37c9FEF21bB9445',
    rewardsController: '0x929EC64c34a17401F460460D4B9390518E5B473e',
    dataProvider: '0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d',
    assets: [
      { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8CC03d5c3359', decimals: 6 },
      { symbol: 'USDC.e', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
      { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
      { symbol: 'DAI', address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18 },
      { symbol: 'WMATIC', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444D3ADf1270', decimals: 18 },
    ],
  },
  42161: {
    pool: '0x794a61358D6845594F94E20bB37c9FEF21bB9445',
    rewardsController: '0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb',
    dataProvider: '0x0000000000000000000000000000000000000000',
    assets: [
      { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
      { symbol: 'USDT', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6 },
      { symbol: 'DAI', address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', decimals: 18 },
      { symbol: 'WETH', address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', decimals: 18 },
      { symbol: 'WBTC', address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8 },
    ],
  },
}

export const AAVE_SUPPORTED_CHAIN_IDS = Object.keys(AAVE_CONFIG).map((id) => Number(id) as AaveSupportedChain)

export const AAVE_POOL_ABI = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const
