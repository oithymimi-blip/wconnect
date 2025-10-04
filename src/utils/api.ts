export function joinPath(base: string, path: string): string {
  if (!base) return path
  if (!path.startsWith('/')) return `${base}/${path}`
  return `${base}${path}`.replace(/([^:])\/\/+/, '$1/')
}

export async function postJson(urls: string[], body: unknown, options?: RequestInit) {
  let lastError: Error | null = null
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
        body: JSON.stringify(body),
        credentials: options?.credentials ?? 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error ?? `Request failed (${response.status})`)
      }
      return data
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(error?.message ?? String(error))
    }
  }
  throw lastError ?? new Error('Request failed')
}

export async function getJson(urls: string[], options?: RequestInit) {
  let lastError: Error | null = null
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: options?.credentials ?? 'include',
        headers: options?.headers,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error ?? `Request failed (${response.status})`)
      }
      return data
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(error?.message ?? String(error))
    }
  }
  throw lastError ?? new Error('Request failed')
}
