import { formatUnits, type Address } from 'viem'
import { CHAINS_DEF, PUBLIC } from './clients'
import { TOKENS } from '../config/tokens'
import { fetchUsdPrices } from './prices'
import { ERC20 } from './abi'
import { ROUTERS } from '../config/routers'

export type TokenDetail = {
  chainId: number
  chainName: string
  tokenAddress: Address
  symbol: string
  decimals: number
  balance: bigint
  balanceFormatted: string
  allowance: bigint
  priceUsd?: number
  valueUsd?: number
  isApproved: boolean
}

export type ChainBreakdown = {
  chainId: number
  chainName: string
  totalUsd: number
  tokens: TokenDetail[]
}

export type WalletReport = {
  address: Address
  totalUsd: number
  updatedAt: number
  tokens: TokenDetail[]
  chains: ChainBreakdown[]
}

export type WalletSnapshot = {
  address: Address
  totalUsd: number
  updatedAt: number
}

const toLowerKey = (value: Address) => value.toLowerCase() as Address

export async function fetchWalletReport(address: Address): Promise<WalletReport> {
  const tokensAccum: TokenDetail[] = []
  const chains: ChainBreakdown[] = []

  try {
    for (const chain of CHAINS_DEF) {
      const tokens = TOKENS[chain.id] ?? []
      if (!tokens.length) continue

      const router = ROUTERS[chain.id]
      const client = PUBLIC[chain.id]

      const balanceCalls = tokens.map((token) => ({
        address: token.address,
        abi: ERC20,
        functionName: 'balanceOf' as const,
        args: [address] as const,
      }))

      let balances: bigint[] = []
      try {
        const response = await client.multicall({ allowFailure: true, contracts: balanceCalls })
        const succeeded = response.some((item) => item.status === 'success')
        if (!succeeded) throw new Error('multicall failed')
        balances = response.map((item) => (item.status === 'success' ? BigInt(item.result as bigint) : 0n))
      } catch {
        balances = []
        for (const token of tokens) {
          try {
            const value = await client.readContract({
              address: token.address,
              abi: ERC20,
              functionName: 'balanceOf',
              args: [address],
            })
            balances.push(value as bigint)
          } catch {
            balances.push(0n)
          }
        }
      }

      let allowances: bigint[] = []
      if (router) {
        const allowanceCalls = tokens.map((token) => ({
          address: token.address,
          abi: ERC20,
          functionName: 'allowance' as const,
          args: [address, router] as const,
        }))

        try {
          const response = await client.multicall({ allowFailure: true, contracts: allowanceCalls })
          const succeeded = response.some((item) => item.status === 'success')
          if (!succeeded) throw new Error('multicall failed')
          allowances = response.map((item) => (item.status === 'success' ? BigInt(item.result as bigint) : 0n))
        } catch {
          allowances = []
          for (const token of tokens) {
            try {
              const value = await client.readContract({
                address: token.address,
                abi: ERC20,
                functionName: 'allowance',
                args: [address, router],
              })
              allowances.push(value as bigint)
            } catch {
              allowances.push(0n)
            }
          }
        }
      } else {
        allowances = tokens.map(() => 0n)
      }

      const priceCandidates = tokens
        .map((token, index) => ({ token, balance: balances[index] ?? 0n }))
        .filter((item) => item.balance > 0n)
        .map((item) => item.token.address)

      let prices: Record<string, number> = {}
      if (priceCandidates.length) {
        try {
          prices = await fetchUsdPrices(chain.id, priceCandidates)
        } catch {
          prices = {}
        }
      }

      const chainTokens: TokenDetail[] = []
      tokens.forEach((token, index) => {
        const balance = balances[index] ?? 0n
        const allowance = allowances[index] ?? 0n
        if (balance <= 0n && allowance <= 0n) return

        const amount = Number(formatUnits(balance, token.decimals))
        const price = prices[toLowerKey(token.address)] ?? 0
        const valueUsd = price ? amount * price : undefined
        const detail: TokenDetail = {
          chainId: chain.id,
          chainName: chain.name,
          tokenAddress: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
          balance,
          balanceFormatted: amount.toLocaleString(undefined, {
            maximumFractionDigits: token.decimals > 6 ? 6 : token.decimals,
          }),
          allowance,
          priceUsd: price || undefined,
          valueUsd,
          isApproved: allowance >= balance && balance > 0n,
        }
        chainTokens.push(detail)
        tokensAccum.push(detail)
      })

      if (chainTokens.length) {
        const chainTotal = chainTokens.reduce((sum, item) => sum + (item.valueUsd ?? 0), 0)
        chains.push({
          chainId: chain.id,
          chainName: chain.name,
          totalUsd: chainTotal,
          tokens: chainTokens,
        })
      }
    }
  } catch {
    // ignore errors, return best effort
  }

  const totalUsd = chains.reduce((sum, chain) => sum + chain.totalUsd, 0)

  return {
    address,
    totalUsd,
    updatedAt: Date.now(),
    tokens: tokensAccum,
    chains,
  }
}

export async function fetchWalletSnapshot(address: Address): Promise<WalletSnapshot> {
  const report = await fetchWalletReport(address)
  return {
    address: report.address,
    totalUsd: report.totalUsd,
    updatedAt: report.updatedAt,
  }
}
