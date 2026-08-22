/**
 * Surgical text-level patcher for .nam file metadata — see CLAUDE.md's "CRITICAL — File Write
 * Strategy". Never JSON.parse -> JSON.stringify a .nam file: that reformats/reorders the whole
 * file and can silently corrupt model weights or field order other tools depend on. Every write
 * path in this app must go through patchMetadataFields (or a sibling patcher built on the same
 * primitives below), which replaces only the bytes of the changed value and leaves everything
 * else — formatting, whitespace, field order, weights, config — untouched.
 *
 * Extracted out of main/index.ts (which imports `electron` at module scope and isn't importable
 * outside a real Electron process) so this critical-path logic can actually be unit tested.
 */

// Returns the root-level /"metadata"\s*:\s*\{/ match.
// A2 (SlimmableContainer) files also embed "metadata" inside each submodel under config.
// Patchers must target the top-level metadata object because that is what the UI reads.
export function findOuterMetadataMatch(content: string): RegExpExecArray | null {
  let inString = false
  let escaped = false
  let objectDepth = 0
  let arrayDepth = 0
  const metadataRe = /^"metadata"\s*:\s*\{/

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (objectDepth === 1 && arrayDepth === 0 && ch === '"') {
      const token = metadataRe.exec(content.slice(i))
      if (token) {
        const match = [token[0]] as unknown as RegExpExecArray
        match.index = i
        match.input = content
        return match
      }
    }

    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      objectDepth++
    } else if (ch === '}') {
      objectDepth = Math.max(0, objectDepth - 1)
    } else if (ch === '[') {
      arrayDepth++
    } else if (ch === ']') {
      arrayDepth = Math.max(0, arrayDepth - 1)
    }
  }

  return null
}

// Find the matching closing brace/bracket, correctly skipping strings
export function findMatchingBrace(content: string, openPos: number): number {
  let depth = 0
  let i = openPos
  while (i < content.length) {
    const ch = content[i]
    if (ch === '"') {
      i++
      while (i < content.length) {
        if (content[i] === '\\') { i += 2; continue }
        if (content[i] === '"') break
        i++
      }
    } else if (ch === '{' || ch === '[') {
      depth++
    } else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

export function serializeJsonValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return String(value)
  return JSON.stringify(String(value))
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Surgically patch only the changed metadata fields in the raw file text.
// All original formatting, whitespace, field order, and non-metadata content
// (weights, config, etc.) are preserved byte-for-byte.
export function patchMetadataFields(content: string, patches: Record<string, unknown>): string {
  // Find the "metadata": { block (use last match for A2 compatibility)
  const metaKeyMatch = findOuterMetadataMatch(content)
  if (!metaKeyMatch) throw new Error('No "metadata" block found in file')

  const openBrace = metaKeyMatch.index + metaKeyMatch[0].length - 1
  const closeBrace = findMatchingBrace(content, openBrace)
  if (closeBrace === -1) throw new Error('Malformed metadata block')

  const prefix = content.slice(0, openBrace + 1) // up to and including {
  let inner = content.slice(openBrace + 1, closeBrace)
  const tail = content.slice(closeBrace)           // } onwards

  for (const [key, value] of Object.entries(patches)) {
    const newVal = serializeJsonValue(value)
    // Match "key"\s*:\s*<JSON-value> — handles null, strings, and numbers
    const re = new RegExp(
      `("${escapeRe(key)}")(\\s*:\\s*)(null|"(?:[^"\\\\]|\\\\.)*"|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`
    )
    if (re.test(inner)) {
      // Replace only the value; keep the key token and spacing intact
      inner = inner.replace(re, (_m, k, sep) => k + sep + newVal)
    } else if (value !== null && value !== undefined) {
      // Field doesn't exist yet — insert it, matching the file's indentation style
      const indentMatch = /\n([ \t]+)"/.exec(inner)
      const indent = indentMatch ? indentMatch[1] : '    '
      const trimmed = inner.trimEnd()
      const needsComma = trimmed.length > 0 && !trimmed.endsWith(',')
      // Preserve whatever trailing whitespace/newline was before the closing brace
      const trailing = inner.slice(trimmed.length)
      inner = trimmed + (needsComma ? ',' : '') + `\n${indent}"${key}": ${newVal}` + trailing
    }
  }

  return prefix + inner + tail
}
