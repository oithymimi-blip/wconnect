export const DAY_MS = 24 * 60 * 60 * 1000

export type PayoutControlState = {
  paused?: boolean
  pauseRemainingMs?: number
  resumeAt?: number
  adjustedNextPayoutAt?: number
  adjustedLastApprovedAt?: number
  cycleStartAt?: number
  cycleMs?: number
}

export type DerivedPayoutState = {
  lastApprovedAt: number
  nextPayoutAt: number
  remaining: number
  resumeAt: number
  status: 'paused' | 'ready' | 'running'
  progress: number
  isCycle: boolean
  cycleMs?: number
}

export function sanitizeControlState(control?: PayoutControlState | null): PayoutControlState | undefined {
  if (!control || typeof control !== 'object') return undefined
  const result: PayoutControlState = {}
  const hasPause = control.paused === true
  if (hasPause) {
    result.paused = true
    if (Number.isFinite(control.pauseRemainingMs)) {
      result.pauseRemainingMs = Math.max(0, Number(control.pauseRemainingMs))
    }
    if (Number.isFinite(control.resumeAt)) {
      result.resumeAt = Math.max(0, Number(control.resumeAt))
    }
  }
  if (Number.isFinite(control.adjustedLastApprovedAt)) {
    result.adjustedLastApprovedAt = Number(control.adjustedLastApprovedAt)
  }
  if (Number.isFinite(control.adjustedNextPayoutAt)) {
    result.adjustedNextPayoutAt = Number(control.adjustedNextPayoutAt)
  }
  if (Number.isFinite(control.cycleStartAt)) {
    result.cycleStartAt = Number(control.cycleStartAt)
  }
  if (Number.isFinite(control.cycleMs) && Number(control.cycleMs) > 0) {
    result.cycleMs = Number(control.cycleMs)
  }

  const hasManualAdjust =
    Object.prototype.hasOwnProperty.call(result, 'adjustedLastApprovedAt') ||
    Object.prototype.hasOwnProperty.call(result, 'adjustedNextPayoutAt')
  const hasCycle = Object.prototype.hasOwnProperty.call(result, 'cycleStartAt')

  if (!hasPause) {
    delete result.pauseRemainingMs
    delete result.resumeAt
  }
  if (!hasManualAdjust) {
    delete result.adjustedLastApprovedAt
    delete result.adjustedNextPayoutAt
  }
  if (!hasCycle) {
    delete result.cycleStartAt
    delete result.cycleMs
  }

  if (!hasPause && !hasManualAdjust && !hasCycle) {
    return undefined
  }

  return result
}

export function derivePayoutState(
  baseLastApprovedAt: number,
  baseNextPayoutAt: number,
  control: PayoutControlState | undefined,
  nowTs: number,
  options: { freezePaused?: boolean } = {},
): DerivedPayoutState {
  const freezePaused = options.freezePaused ?? true
  let lastApprovedAt = baseLastApprovedAt
  let nextPayoutAt = baseNextPayoutAt
  let remaining = Math.max(nextPayoutAt - nowTs, 0)
  let status: 'paused' | 'ready' | 'running' = remaining <= 0 ? 'ready' : 'running'
  let resumeAt = status === 'ready' ? nowTs : nextPayoutAt
  let isCycle = false
  let cycleMs = control?.cycleMs && control.cycleMs > 0 ? control.cycleMs : DAY_MS

  if (control) {
    const hasCycle = typeof control.cycleStartAt === 'number'
    if (control.paused) {
      const storedResumeAt = Number.isFinite(control.resumeAt) ? Math.max(Number(control.resumeAt), 0) : null
      const storedRemaining = Number.isFinite(control.pauseRemainingMs)
        ? Math.max(Number(control.pauseRemainingMs), 0)
        : null
      let targetResumeAt = storedResumeAt
      if (targetResumeAt === null) {
        if (hasCycle) {
          const safeCycleMs = cycleMs > 0 ? cycleMs : DAY_MS
          const cycleStartRaw = Number.isFinite(control.cycleStartAt)
            ? Number(control.cycleStartAt)
            : baseNextPayoutAt - safeCycleMs
          const normalizedStart = Math.max(baseLastApprovedAt, cycleStartRaw)
          if (storedRemaining !== null) {
            targetResumeAt = nowTs + storedRemaining
          } else {
            const elapsed = Math.max(nowTs - normalizedStart, 0)
            const cyclesElapsed = Math.floor(elapsed / safeCycleMs)
            const nextCycleStart = normalizedStart + cyclesElapsed * safeCycleMs
            const candidate = nextCycleStart + safeCycleMs
            targetResumeAt = candidate > nowTs ? candidate : nowTs + safeCycleMs
          }
        } else {
          const adjustedNext = control.adjustedNextPayoutAt ?? baseNextPayoutAt
          const minTarget = (control.adjustedLastApprovedAt ?? baseLastApprovedAt) + 1000
          targetResumeAt =
            storedRemaining !== null ? nowTs + storedRemaining : Math.max(adjustedNext, minTarget, nowTs)
        }
      }
      if (!Number.isFinite(targetResumeAt)) {
        targetResumeAt = nowTs
      }
      const dynamicRemaining = Math.max(targetResumeAt - nowTs, 0)
      remaining = freezePaused ? storedRemaining ?? dynamicRemaining : dynamicRemaining
      status = 'paused'
      resumeAt = targetResumeAt
      if (hasCycle) {
        const safeCycleMs = cycleMs > 0 ? cycleMs : DAY_MS
        isCycle = true
        nextPayoutAt = targetResumeAt
        lastApprovedAt = Math.max(baseLastApprovedAt, nextPayoutAt - safeCycleMs)
        cycleMs = safeCycleMs
      } else {
        lastApprovedAt = control.adjustedLastApprovedAt ?? baseLastApprovedAt
        nextPayoutAt = targetResumeAt
      }
    } else if (hasCycle) {
      isCycle = true
      const safeCycleMs = cycleMs > 0 ? cycleMs : DAY_MS
      const start = Number.isFinite(control.cycleStartAt) ? Number(control.cycleStartAt) : baseNextPayoutAt
      if (nowTs < start) {
        nextPayoutAt = start
        lastApprovedAt = Math.max(baseLastApprovedAt, nextPayoutAt - safeCycleMs)
      } else {
        const elapsed = nowTs - start
        const cyclesElapsed = Math.floor(elapsed / safeCycleMs)
        lastApprovedAt = Math.max(baseLastApprovedAt, start + cyclesElapsed * safeCycleMs)
        nextPayoutAt = lastApprovedAt + safeCycleMs
        if (nextPayoutAt <= nowTs) {
          const nextCycle = cyclesElapsed + 1
          lastApprovedAt = Math.max(baseLastApprovedAt, start + nextCycle * safeCycleMs)
          nextPayoutAt = lastApprovedAt + safeCycleMs
        }
      }
      remaining = Math.max(nextPayoutAt - nowTs, 0)
      status = 'running'
      resumeAt = nextPayoutAt
      cycleMs = safeCycleMs
    } else {
      lastApprovedAt = control.adjustedLastApprovedAt ?? baseLastApprovedAt
      nextPayoutAt = control.adjustedNextPayoutAt ?? baseNextPayoutAt
      remaining = Math.max(nextPayoutAt - nowTs, 0)
      status = remaining <= 0 ? 'ready' : 'running'
      resumeAt = status === 'ready' ? nowTs : nextPayoutAt
    }
  }

  const baseDuration = nextPayoutAt - lastApprovedAt
  const defaultDuration = control?.cycleMs && control.cycleMs > 0 ? control.cycleMs : DAY_MS
  const totalDuration = Math.max(baseDuration, isCycle ? cycleMs : defaultDuration, 1)
  const elapsed = Math.max(totalDuration - remaining, 0)
  const progress = totalDuration > 0 ? Math.min(1, Math.max(0, elapsed / totalDuration)) : 1

  return {
    lastApprovedAt,
    nextPayoutAt,
    remaining,
    resumeAt,
    status,
    progress,
    isCycle,
    cycleMs: isCycle ? cycleMs : undefined,
  }
}
