/**
 * A small pool of long-lived render workers, for Scan mode.
 *
 * The preview player terminates its worker after every render, which is fine when you press play
 * once. Sweeping needs the opposite: each worker caches the compiled WASM module in a module-level
 * promise, so keeping workers alive turns a fresh module load per capture into a one-off cost.
 *
 * The worker protocol has no request IDs — it posts exactly one response per message. That is
 * enough to correlate safely as long as a worker is only ever given one job at a time, which is
 * what `busy` enforces here. Handing a worker a second job before the first replied would silently
 * mismatch results to captures, so the invariant matters more than it looks.
 */
import type { NamRenderRequest, NamRenderResponse } from '../workers/namRender.worker'

interface Slot {
  worker: Worker
  busy: boolean
}

interface Job {
  request: NamRenderRequest
  resolve: (r: NamRenderResponse) => void
  reject: (e: Error) => void
}

export class ScanRenderPool {
  private slots: Slot[] = []
  private queue: Job[] = []
  private disposed = false

  constructor(
    private readonly createWorker: () => Worker,
    concurrency = 4
  ) {
    for (let i = 0; i < Math.max(1, concurrency); i++) {
      this.slots.push({ worker: createWorker(), busy: false })
    }
  }

  get size(): number {
    return this.slots.length
  }

  /** Jobs waiting plus jobs running — what the prefetch planner treats as in flight. */
  get pending(): number {
    return this.queue.length + this.slots.filter((s) => s.busy).length
  }

  render(request: NamRenderRequest): Promise<NamRenderResponse> {
    if (this.disposed) return Promise.reject(new Error('Scan render pool was disposed'))
    return new Promise<NamRenderResponse>((resolve, reject) => {
      this.queue.push({ request, resolve, reject })
      this.pump()
    })
  }

  private pump(): void {
    if (this.disposed) return
    for (const slot of this.slots) {
      if (slot.busy || this.queue.length === 0) continue
      const job = this.queue.shift()!
      slot.busy = true

      const done = (): void => {
        slot.worker.onmessage = null
        slot.worker.onerror = null
        slot.busy = false
        this.pump()
      }

      slot.worker.onmessage = (event: MessageEvent<NamRenderResponse>) => {
        done()
        job.resolve(event.data)
      }
      slot.worker.onerror = (event) => {
        // A crashed worker can't be reused - replace the slot so one bad capture doesn't
        // permanently shrink the pool.
        try {
          slot.worker.terminate()
        } catch {
          // Already gone.
        }
        slot.worker = this.createWorker()
        done()
        job.reject(new Error(event.message || 'Render worker crashed'))
      }

      try {
        slot.worker.postMessage(job.request, [job.request.input.buffer])
      } catch (error) {
        done()
        job.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  dispose(): void {
    this.disposed = true
    for (const slot of this.slots) {
      try {
        slot.worker.terminate()
      } catch {
        // Already gone.
      }
    }
    this.slots = []
    const queued = this.queue.splice(0)
    for (const job of queued) job.reject(new Error('Scan render pool was disposed'))
  }
}
