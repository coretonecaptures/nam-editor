/**
 * Vendor parser interface — docs/ir-lab-manager-build-plan.md section 6.
 * `recognizes` is a cheap per-folder check (cached by caller, not re-run per file); `parse`
 * extracts whatever fields it can from one file given that folder context. A parser returning an
 * empty object for a field means "don't know," not "blank" — the confidence-ladder writer
 * (see applyVendorParsers.ts) only ever fills gaps, never asserts a field it isn't sure of.
 */
export interface ParsedIrFields {
  manufacturer?: string
  cabinet?: string
  speaker?: string
  microphone?: string
  position?: string
}

export interface VendorParser {
  id: string
  recognizes(folderPath: string, siblingFiles: string[]): boolean
  parse(filePath: string, folderPath: string): ParsedIrFields
}
