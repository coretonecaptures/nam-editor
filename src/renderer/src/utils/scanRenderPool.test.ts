/**
 * The pool's correctness rests on one invariant: a worker is only ever given one job at a time.
 *
 * The render worker's protocol has no request IDs — it posts exactly one response per message —
 * so a worker handed two jobs at once would resolve the first promise with the second capture's
 * audio. That is silent and would sound like the wrong capture playing, so it is worth pinning.
 */
import { describe, it, expect } from 'vitest'
import { ScanRenderPool } from './scanRenderPool'
import type { NamRenderRequest, NamRenderResponse } from '../workers/namRender.worker'

/** Minimal stand-in for a render worker; replies only when told to. */
class FakeWorker {
  onmessage: ((e: MessageEvent<NamRenderResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  readonly received: NamRenderRequest[] = []
  /** How many messages have been posted without a reply yet. */
  outstanding = 0
  terminated = false

  postMessage(request: NamRenderRequest): void {
    this.received.push(request)
    this.outstanding++
  }

  reply(response: NamRenderResponse): void {
    this.outstanding--
    this.onmessage?.({ data: response } as MessageEvent<NamRenderResponse>)
  }

  fail(message: string): void {
    this.outstanding--
    this.onerror?.({ message } as ErrorEvent)
  }

  terminate(): void {
    this.terminated = true
  }
}

/** Fire-and-forget submit. dispose() rejects anything outstanding, so swallow it. */
function submit(pool: ScanRenderPool, tag: string): void {
  pool.render(req(tag)).catch(() => {})
}

function req(tag: string): NamRenderRequest {
  return { modelJson: tag, input: new Float32Array(4), sampleRate: 48000 }
}

function ok(): NamRenderResponse {
  return { ok: true, output: new Float32Array(4), loudnessDb: null, renderMs: 1 } as NamRenderResponse
}

function makePool(concurrency: number): { pool: ScanRenderPool; workers: FakeWorker[] } {
  const workers: FakeWorker[] = []
  const pool = new ScanRenderPool(() => {
    const w = new FakeWorker()
    workers.push(w)
    return w as unknown as Worker
  }, concurrency)
  return { pool, workers }
}

describe('ScanRenderPool', () => {
  it('creates the requested number of workers', () => {
    const { pool, workers } = makePool(3)
    expect(workers).toHaveLength(3)
    expect(pool.size).toBe(3)
    pool.dispose()
  })

  it('never gives a worker a second job before the first replies', async () => {
    const { pool, workers } = makePool(2)
    // Four jobs, two workers: two must wait in the queue rather than doubling up.
    for (const tag of ['a', 'b', 'c', 'd']) submit(pool, tag)
    expect(workers.every((w) => w.outstanding <= 1)).toBe(true)
    expect(workers[0].received).toHaveLength(1)
    expect(workers[1].received).toHaveLength(1)
    pool.dispose()
  })

  it('hands a queued job over as soon as a worker frees up', async () => {
    const { pool, workers } = makePool(1)
    const first = pool.render(req('a'))
    submit(pool, 'b')
    expect(workers[0].received.map((r) => r.modelJson)).toEqual(['a'])

    workers[0].reply(ok())
    await first
    expect(workers[0].received.map((r) => r.modelJson)).toEqual(['a', 'b'])
    expect(workers[0].outstanding).toBe(1)
    pool.dispose()
  })

  it('resolves each caller with its own result', async () => {
    const { pool, workers } = makePool(2)
    const a = pool.render(req('a'))
    const b = pool.render(req('b'))
    // Reply out of order — each promise must still get its own worker's response.
    workers[1].reply({ ...ok(), renderMs: 22 } as NamRenderResponse)
    workers[0].reply({ ...ok(), renderMs: 11 } as NamRenderResponse)
    const [ra, rb] = [await a, await b]
    // Narrow the response union before reading the success-only field.
    expect(ra.ok && ra.renderMs).toBe(11)
    expect(rb.ok && rb.renderMs).toBe(22)
    pool.dispose()
  })

  it('spreads work across all workers rather than queueing on one', () => {
    const { pool, workers } = makePool(4)
    for (let i = 0; i < 4; i++) submit(pool, `j${i}`)
    expect(workers.every((w) => w.received.length === 1)).toBe(true)
    pool.dispose()
  })

  it('counts queued and running jobs as pending, so prefetch can budget', () => {
    const { pool } = makePool(2)
    expect(pool.pending).toBe(0)
    for (let i = 0; i < 5; i++) submit(pool, `j${i}`)
    expect(pool.pending).toBe(5)
    pool.dispose()
  })

  it('replaces a crashed worker so one bad capture does not shrink the pool', async () => {
    const { pool, workers } = makePool(1)
    const first = pool.render(req('bad'))
    workers[0].fail('boom')
    await expect(first).rejects.toThrow(/boom/)
    // A replacement was created, and the pool still accepts work.
    expect(workers.length).toBe(2)
    submit(pool, 'next')
    expect(workers[1].received).toHaveLength(1)
    pool.dispose()
  })

  it('rejects queued jobs and terminates workers on dispose', async () => {
    const { pool, workers } = makePool(1)
    const running = pool.render(req('a'))
    running.catch(() => {})
    const queued = pool.render(req('b'))
    pool.dispose()
    await expect(queued).rejects.toThrow(/disposed/)
    expect(workers.every((w) => w.terminated)).toBe(true)
  })

  it('refuses new work after disposal instead of resolving nothing', async () => {
    const { pool } = makePool(1)
    pool.dispose()
    await expect(pool.render(req('a'))).rejects.toThrow(/disposed/)
  })

  it('always keeps at least one worker, however small the concurrency asked for', () => {
    const { pool, workers } = makePool(0)
    expect(workers.length).toBeGreaterThanOrEqual(1)
    pool.dispose()
  })
})
