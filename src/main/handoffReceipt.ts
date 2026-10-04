/**
 * Receipts for IR Lab -> NAM Lab hand-offs. IR Lab adds `op=<id>` to every namlab:// link and
 * polls for `<IR Lab data folder>/namlab-receipts/<op>.json`; without it IR Lab could only say
 * "macOS accepted the URL", not "NAM Lab got it". Written by the main process the moment a link
 * is handled (or refused), atomically (temp file + rename) so IR Lab never reads half a file.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OP_PATTERN = /^[A-Za-z0-9-]{8,64}$/

/** The link's operation id, or null when absent or not a plain id (never a path fragment). */
export function parseHandoffOp(urlString: string): string | null {
  try {
    const op = new URL(urlString).searchParams.get('op')
    return op && OP_PATTERN.test(op) ? op : null
  } catch {
    return null
  }
}

export interface HandoffReceipt {
  op: string
  route: string
  ok: boolean
  message: string
  receivedAt: string
}

export function receiptFile(irLabDataDir: string, op: string): string {
  return join(irLabDataDir, 'namlab-receipts', `${op}.json`)
}

export function writeHandoffReceipt(irLabDataDir: string, receipt: HandoffReceipt): void {
  if (!OP_PATTERN.test(receipt.op)) return
  const file = receiptFile(irLabDataDir, receipt.op)
  try {
    mkdirSync(join(irLabDataDir, 'namlab-receipts'), { recursive: true })
    const temp = `${file}.tmp`
    writeFileSync(temp, JSON.stringify(receipt, null, 2), 'utf-8')
    renameSync(temp, file)
  } catch {
    // A receipt is a courtesy to IR Lab; failing to write one must never block the hand-off.
  }
}
