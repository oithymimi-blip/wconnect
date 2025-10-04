// src/lib/permit.ts
import type { Address, Hex, TypedDataDomain } from 'viem'
import type { PublicClient } from 'viem'
import { ERC20 } from './abi'

export async function supportsPermit2612(
  token: Address,
  owner: Address,
  pc: PublicClient
) {
  try {
    await pc.readContract({ address: token, abi: ERC20, functionName: 'nonces', args: [owner] })
    await pc.readContract({ address: token, abi: ERC20, functionName: 'DOMAIN_SEPARATOR' })
    return true
  } catch {
    return false
  }
}

export async function buildPermitTypedData(
  token: Address,
  owner: Address,
  spender: Address,
  value: bigint,
  chainId: number,
  pc: PublicClient
) {
  const name = (await pc.readContract({ address: token, abi: ERC20, functionName: 'name' })) as string
  const nonce = (await pc.readContract({ address: token, abi: ERC20, functionName: 'nonces', args: [owner] })) as bigint
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30) // 30d

  const domain: TypedDataDomain = { name, version: '1', chainId, verifyingContract: token }
  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  }
  const message = { owner, spender, value, nonce, deadline }
  return { domain, types, message, deadline }
}

export function splitSig(sig: Hex) {
  const r = ('0x' + sig.slice(2, 66)) as Hex
  const s = ('0x' + sig.slice(66, 130)) as Hex
  const v = parseInt(sig.slice(130, 132), 16)
  return { v, r, s }
}
