/**
 * Bounded-concurrency map — the fix for Phase 1's measured throughput collapse
 * (docs/ir-lab-manager-build-plan.md section 12): the scan/hash loop was doing every file's I/O
 * fully serially, one file at a time, which measured at 7% CPU utilization (i.e. almost entirely
 * idle, waiting on each syscall's round trip) and a throughput collapse from ~1,600 to
 * ~47-100 items/sec between a small cached folder and the real ~525K-file library. This lets N
 * files' I/O be in flight at once instead of one.
 */
export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}
