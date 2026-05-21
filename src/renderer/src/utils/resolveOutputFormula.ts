export interface FormulaStep {
  segment: string
  resolved: string
  label: string
}

export interface FormulaResolution {
  steps: FormulaStep[]
  result: string
}

function normSep(path: string): string {
  return path.replace(/\\/g, '/')
}

function toNativeSep(path: string, original: string): string {
  const usesBackslash = original.includes('\\')
  return usesBackslash ? path.replace(/\//g, '\\') : path
}

export function resolveOutputFormula(
  formula: string,
  stagingPath: string,
  architectureName: string
): string | null {
  if (!formula.trim() || !stagingPath.trim()) return null
  const res = resolveOutputFormulaWithSteps(formula, stagingPath, architectureName)
  return res?.result ?? null
}

export function resolveOutputFormulaWithSteps(
  formula: string,
  stagingPath: string,
  architectureName: string
): FormulaResolution | null {
  if (!formula.trim() || !stagingPath.trim()) return null

  const normalized = normSep(stagingPath).replace(/\/+$/, '')
  const parts = normalized.split('/')
  const folder = parts[parts.length - 1] ?? ''
  const parent = parts[parts.length - 2] ?? ''

  // Substitute tokens in each segment of the formula
  const formulaSegments = normSep(formula).split('/').filter((s) => s !== '')

  const base = [...parts]
  const steps: FormulaStep[] = [
    { segment: 'start', label: 'Staging path', resolved: toNativeSep(base.join('/'), stagingPath) },
  ]

  for (const raw of formulaSegments) {
    const seg = raw
      .replace(/\{folder\}/g, folder)
      .replace(/\{parent\}/g, parent)
      .replace(/\{architecture\}/g, architectureName)

    if (seg === '..') {
      if (base.length > 1) base.pop()
      steps.push({
        segment: '../',
        label: 'Up one level',
        resolved: toNativeSep(base.join('/'), stagingPath),
      })
    } else if (seg && seg !== '.') {
      base.push(seg)
      // Build a readable label for token substitutions
      let label = seg
      if (raw.includes('{folder}')) label = `{folder} → ${folder}`
      else if (raw.includes('{parent}')) label = `{parent} → ${parent}`
      else if (raw.includes('{architecture}')) label = `{architecture} → ${architectureName}`
      steps.push({
        segment: raw + '/',
        label,
        resolved: toNativeSep(base.join('/'), stagingPath),
      })
    }
  }

  return { steps, result: toNativeSep(base.join('/'), stagingPath) }
}

/** Returns the effective formula for a run, respecting preset override > global > empty. */
export function effectiveFormula(
  globalFormula: string,
  presetOverride: string | undefined | null
): string {
  if (typeof presetOverride === 'string' && presetOverride.trim() !== '') return presetOverride.trim()
  return globalFormula?.trim() ?? ''
}
