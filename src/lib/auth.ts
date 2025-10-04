import { withBase } from './adminApi'

export type SessionInfo = {
  email: string
  expiresAt: number
}

async function parseJson(response: Response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

export async function requestOtp(email: string) {
  const response = await fetch(withBase('/api/auth/request-otp'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  })
  if (!response.ok) {
    const data = await parseJson(response)
    throw new Error(data?.error ?? 'Failed to send one-time code')
  }
  return (await parseJson(response)) as { email?: string; expiresAt?: number }
}

export async function verifyOtp(email: string, otp: string): Promise<SessionInfo> {
  const response = await fetch(withBase('/api/auth/verify-otp'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, otp }),
  })
  if (!response.ok) {
    const data = await parseJson(response)
    throw new Error(data?.error ?? 'Invalid verification code')
  }
  return (await parseJson(response)) as SessionInfo
}

export async function fetchSession(): Promise<SessionInfo> {
  const response = await fetch(withBase('/api/auth/session'), {
    method: 'GET',
    credentials: 'include',
  })
  if (!response.ok) {
    const data = await parseJson(response)
    const message = data?.error ?? `Session check failed (${response.status})`
    throw new Error(message)
  }
  return (await parseJson(response)) as SessionInfo
}

export async function logout() {
  await fetch(withBase('/api/auth/logout'), {
    method: 'POST',
    credentials: 'include',
  })
}
