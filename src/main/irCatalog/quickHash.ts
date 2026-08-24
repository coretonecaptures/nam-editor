/**
 * Cheap per-file fingerprint, computed inline during the scan itself.
 *
 * docs/ir-lab-manager-build-plan.md section 4: full-content hashing 500K WAVs means reading
 * hundreds of GB off disk, so it stays a lazy background job (content_hash, not implemented in
 * Phase 1 — see the plan). `quick_hash` gets nearly all of the dedup/reconciliation value for a
 * fraction of the I/O: file size plus a hash of the first and last 64KB. Two different WAVs
 * matching on size + both boundary chunks is not realistic for audio content, so this is treated
 * as a strong (not just probabilistic) signal for reconciliation tier 2 — see the plan's section 5.
 */
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'

const CHUNK_SIZE = 64 * 1024

export async function computeQuickHash(absPath: string, size: number): Promise<string> {
  const hash = createHash('sha1')
  hash.update(String(size))

  const fh = await fs.promises.open(absPath, 'r')
  try {
    const head = Buffer.alloc(Math.min(CHUNK_SIZE, size))
    if (head.length > 0) {
      await fh.read(head, 0, head.length, 0)
      hash.update(head)
    }

    if (size > CHUNK_SIZE) {
      const tailStart = Math.max(size - CHUNK_SIZE, head.length)
      const tail = Buffer.alloc(size - tailStart)
      await fh.read(tail, 0, tail.length, tailStart)
      hash.update(tail)
    }
  } finally {
    await fh.close()
  }

  return hash.digest('hex')
}
