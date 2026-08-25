import { describe, it, expect, afterEach } from 'vitest'
import {
  tryAcquireLiveEngine,
  releaseLiveEngine,
  getActiveLiveEngineOwner,
  subscribeLiveEngineOwner,
  describeLiveEngineOwner
} from './liveEngineOwner'

// Module-level singleton state — reset between tests so one test's acquire doesn't leak into
// the next (this mirrors app reality: releaseLiveEngine is always called on every stop/unmount
// path, so a clean slate between tests is the correct baseline, not a workaround).
afterEach(() => {
  releaseLiveEngine('nam')
  releaseLiveEngine('ir-mode')
})

describe('liveEngineOwner', () => {
  it('the first owner to acquire succeeds and becomes the active owner', () => {
    expect(tryAcquireLiveEngine('nam')).toBe(true)
    expect(getActiveLiveEngineOwner()).toBe('nam')
  })

  it('a different owner is refused while another owner is active', () => {
    expect(tryAcquireLiveEngine('nam')).toBe(true)
    expect(tryAcquireLiveEngine('ir-mode')).toBe(false)
    expect(getActiveLiveEngineOwner()).toBe('nam')
  })

  it('the same owner re-acquiring (e.g. a restart) is always allowed', () => {
    expect(tryAcquireLiveEngine('nam')).toBe(true)
    expect(tryAcquireLiveEngine('nam')).toBe(true)
    expect(getActiveLiveEngineOwner()).toBe('nam')
  })

  it('releasing frees the slot for a different owner', () => {
    expect(tryAcquireLiveEngine('nam')).toBe(true)
    releaseLiveEngine('nam')
    expect(getActiveLiveEngineOwner()).toBeNull()
    expect(tryAcquireLiveEngine('ir-mode')).toBe(true)
  })

  it('releasing an owner that does not hold the slot is a harmless no-op', () => {
    expect(tryAcquireLiveEngine('nam')).toBe(true)
    releaseLiveEngine('ir-mode')
    expect(getActiveLiveEngineOwner()).toBe('nam')
  })

  it('subscribers are notified on acquire and release', () => {
    const seen: Array<'nam' | 'ir-mode' | null> = []
    const unsubscribe = subscribeLiveEngineOwner((owner) => seen.push(owner))
    tryAcquireLiveEngine('nam')
    releaseLiveEngine('nam')
    unsubscribe()
    tryAcquireLiveEngine('ir-mode')
    expect(seen).toEqual(['nam', null])
  })

  it('describeLiveEngineOwner gives a human-readable label for the error message', () => {
    expect(describeLiveEngineOwner('nam')).toBe('NAM mode')
    expect(describeLiveEngineOwner('ir-mode')).toBe('IR mode')
  })
})
