export function formatAddress(address?: string) {
  if (!address) return ''
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
