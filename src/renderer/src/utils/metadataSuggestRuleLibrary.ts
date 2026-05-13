import { MetadataSuggestRule } from '../types/settings'

export function isMetadataSuggestRuleComplete(rule: MetadataSuggestRule): boolean {
  return rule.value.trim().length > 0
}

export function isMetadataSuggestRuleLibraryCandidate(rule: MetadataSuggestRule): boolean {
  return rule.token.trim().length > 0 && rule.value.trim().length > 0
}

export function metadataSuggestRuleSignature(rule: MetadataSuggestRule): string {
  return [
    rule.token.trim().toLowerCase(),
    rule.segmentIndex == null ? '' : String(rule.segmentIndex),
    rule.field,
    rule.value.trim(),
    rule.matchIn,
    rule.matchType,
    rule.overwriteExisting ? 'overwrite' : 'blank',
    rule.overwriteOnlyValues.trim().toLowerCase(),
  ].join('||')
}

export function cloneMetadataSuggestRule(rule: MetadataSuggestRule, prefix = 'rule-lib'): MetadataSuggestRule {
  return {
    ...rule,
    id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  }
}
