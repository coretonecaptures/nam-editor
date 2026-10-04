import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseHandoffOp, receiptFile, writeHandoffReceipt } from './handoffReceipt'

describe('handoff receipts', () => {
  it('reads a plain op id from any namlab link', () => {
    expect(parseHandoffOp('namlab://train?project=p&capture=a&op=1f2e3d4c-5b6a')).toBe('1f2e3d4c-5b6a')
    expect(parseHandoffOp('namlab://library?path=%2Fx&op=abcdef12')).toBe('abcdef12')
  })

  it('ignores a missing or unsafe op', () => {
    expect(parseHandoffOp('namlab://project?id=x')).toBeNull()
    expect(parseHandoffOp('namlab://project?id=x&op=..%2F..%2Fetc')).toBeNull()
    expect(parseHandoffOp('namlab://project?id=x&op=short')).toBeNull()
    expect(parseHandoffOp('not a url')).toBeNull()
  })

  it('writes a complete receipt where IR Lab polls for it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'receipt-'))
    try {
      writeHandoffReceipt(dir, { op: 'abcdef12', route: 'train', ok: true, message: 'received', receivedAt: 'now' })
      const file = receiptFile(dir, 'abcdef12')
      expect(JSON.parse(readFileSync(file, 'utf-8'))).toMatchObject({ op: 'abcdef12', ok: true, route: 'train' })
      expect(existsSync(`${file}.tmp`)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
