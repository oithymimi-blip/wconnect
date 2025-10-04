export function determineApiBase(): string {
  const envBase = (import.meta.env.VITE_API_BASE_URL ?? '').trim()
  if (envBase) {
    return envBase.replace(/\/$/, '')
  }

  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location
    if (import.meta.env.DEV) {
      return `${protocol}//${hostname}:4000`
    }
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`
  }

  return ''
}

export const API_BASE = determineApiBase()

export const withApiBase = (path: string) => {
  if (!path.startsWith('/')) return `${API_BASE}/${path}`
  return `${API_BASE}${path}`
}
