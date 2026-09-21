# "Build Your Own Parser" — plan for a user-authored structural vendor parser

Written 2026-09-21, following on from `york.ts` (the third hand-built structural parser —
see `TODO.md`'s note that this doesn't scale to every future vendor) and the existing
Suggestion Rules feature (parity backlog item 20). This is a **plan**, not a build — no code
here, scoped so it can be picked up and estimated on its own.

## 1. The gap this fills

NAM Lab has two ways to pull structure out of a filename today, and there's a real hole
between them:

| | Suggestion Rules (built) | Hand-built vendor parser (`ownhammer.ts`/`redwirez.ts`/`york.ts`) |
|---|---|---|
| Author | User, in-app, no code | A developer, per vendor, as a TypeScript file |
| What it does | "If token X appears anywhere, set field Y" — flat, one rule at a time | Decodes a filename's whole STRUCTURE (cab tokens, then a mic code, then a position, in order) into multiple fields in one pass |
| Code tables | None — matches literal text | Yes — a lookup table translating short/coded tokens (`421` -> `Sennheiser MD421`) |
| Built from | Typed by hand, one rule per field/token | One (or a few) real example filenames, reasoned through by hand |
| Coverage validation | None built in | Manual — this session's York parser was checked against all 16,875 real files by hand, outside the app |

A user with their own private/small vendor's IR pack (or a big vendor we haven't hit yet)
has no way to get OwnHammer/York-style structural decoding without asking for a new
TypeScript file. That's the gap: **let the user build the same kind of structural parser
Suggestion Rules can't express, from their own files, without writing code.**

## 2. Proposed interaction model

Reuses an interaction NAM mode's own suggestion-rule engine doc already named and IR mode's
own Suggestion Rules deliberately deferred in favor of a simpler live-Test panel (see that
feature's own scope note) — this is the feature where the fuller interaction actually earns
its keep, because a flat rule list genuinely can't express "decode this filename's shape."

1. **Pick a scope.** A folder (or a whole library root) the user wants a parser for —
   probably launched from the folder tree's own context menu ("Build a Parser for this
   folder…"), so it starts from a folder the user has already identified as "this vendor's
   pack."
2. **See real example filenames**, sampled from that scope (reuse the same sibling-file
   listing `applyVendorParsers.ts`'s structural parsers already fetch per folder — no new
   query shape needed).
3. **Mark up ONE example.** Click/drag to select a substring within the filename and tag it:
   Manufacturer / Cabinet / Speaker / Microphone / Position / (ignore). Whatever sits between
   two tagged spans (a space, hyphen, underscore) is captured as the delimiter automatically
   — the user never types a regex.
4. **The system proposes a template** from that one marked-up example: an ordered sequence
   of {field, delimiter} tokens (see §4's data model). Shown back to the user as a
   plain-language readout ("Manufacturer, then a space, then Cabinet, then a space, then
   Microphone-and-Position separated by a hyphen") so they can sanity-check it without
   reading a pattern language.
5. **Optional code table per field.** If a field (usually Microphone) extracted a short code
   rather than a real name, an inline "Add a translation" affordance lets the user type
   `421 = Sennheiser MD421` pairs. Entirely optional — an untranslated code is stored raw
   (same "don't guess" convention every built-in parser already follows), never blank.
6. **Live validation against the WHOLE scope**, not just the one example — this is the part
   with no existing precedent in Suggestion Rules and is the actual point of building this:
   run the inferred template against every real file in the chosen folder/root and show a
   coverage number ("187 of 203 files matched, 92%") plus a scrollable preview table of
   extracted fields, with the unmatched files listed separately so the gap is visible, not
   hidden. Same discipline this session's own York validation pass used by hand
   (`docs/` commit for `york.ts` — 16,875 real files, coverage numbers in the commit
   message) — built into the feature this time instead of a one-off manual check.
7. **Save as a named custom parser**, scoped to the folder/root it was built from (or
   promoted to "any folder whose files match this shape" — see §5, open question 2).

## 3. Where it plugs into the existing pipeline

`applyVendorParsers.ts`'s `STRUCTURAL_PARSERS` array already IS the extension point — every
built-in parser (`ownhammerParser`, `redwirezParser`, `yorkParser`) implements one shared
interface:

```ts
interface VendorParser {
  id: string
  recognizes(folderPath: string, siblingFiles: string[]): boolean
  parse(filePath: string, folderPath: string): ParsedIrFields
}
```

A saved custom parser should implement the SAME interface, generically — one small
interpreter function that reads a stored template + code tables and produces `recognizes`/
`parse` behavior at runtime, rather than being compiled TypeScript. `STRUCTURAL_PARSERS`
becomes `[...builtInParsers, ...loadCustomParsers(settings)]`; custom parsers run AFTER the
hand-built, well-validated ones for the same folder (first `recognizes()` match still wins
per folder — unchanged rule), so a user's custom parser never silently overrides a vetted
built-in one for a pack it might coincidentally also match.

Writes still go through the exact same confidence-ladder writer (`fieldConfidence.ts`) at
the `vendor_parser` tier — a custom parser is not a new confidence tier, it's a new SOURCE of
`vendor_parser`-tier writes, indistinguishable in provenance from `york.ts`'s own writes.

## 4. Data model (draft)

```ts
interface CustomVendorParser {
  id: string
  name: string                          // user-given label, e.g. "My Cab Co"
  scope: { libraryRootId: number; folderId: number | null }  // where this was built/applies
  recognizerPrefix?: string             // optional cheap precondition, e.g. a common filename prefix
  delimiter: string                     // the separator inferred from the marked-up example
  fieldTemplate: Array<
    | { kind: 'field'; field: 'manufacturer' | 'cabinet' | 'speaker' | 'microphone' | 'position' }
    | { kind: 'literal' }               // an ignored/opaque token position
  >
  codeTables: Partial<Record<'manufacturer' | 'cabinet' | 'speaker' | 'microphone' | 'position', Record<string, string>>>
  blendMarker?: string                  // a token (e.g. "Mix", "+") that means "don't guess this file" — mirrors
                                         // ownhammer.ts/york.ts's own blend handling
}
```

Storage: `AppSettings.irCustomVendorParsers: CustomVendorParser[]`, same flat-list
convention `irMetadataSuggestRuleLibrary` already established (see that field's own comment
for why flat-list-plus-run-time-scope beats nested per-folder rule sets).

## 5. Open questions — real design decisions, not yet answered here

1. **Single-example templates can't express a variable-length cab-token run.** York's own
   real files ranged from 2 cab tokens (`MTCH 212`) to 3 (`5153 412 VH20`) — a template built
   from ONE example locks in a fixed token count unless the builder UI explicitly supports
   "this many tokens, min-max" for the cabinet span (probably: let the user mark a span as
   spanning "the rest of the tokens up to the mic code" rather than a fixed count — doable,
   but is the actual hard part of this feature, not the delimiter-inference part). Recommend
   starting there in design, since it's the part most likely to reshape the data model above.
2. **Scope semantics**: does a custom parser apply only to the exact folder it was built
   from, or "any folder under this library root," or "any folder anywhere whose files match
   this shape" (global)? Global is the most powerful but the most likely to produce a false
   match against an unrelated vendor's pack that happens to share a delimiter pattern.
   Recommend starting scoped to the root it was built from (safest default, matches how
   Suggestion Rules already scope by "where it's run" rather than going global by default).
3. **Interaction with Suggestion Rules**: should these be two separate features (as sketched
   here), or should Suggestion Rules gain a "build from example" mode that produces a
   structural parser under the hood, unifying the two into one feature with two entry points?
   Two separate features is less UI work short-term; one unified feature is less conceptual
   surface area for the user long-term. Worth a decision before building either further.
4. **Code-table authoring UX** for a field with many codes (a real vendor might have 20-40
   mic codes) — typing `code = name` pairs one at a time is fine for a handful, tedious for
   dozens. A paste-a-table (CSV/TSV) import might be worth it once real usage shows this is
   actually the bottleneck, not before.

## 6. Suggested build order (MVP first)

1. Data model + `applyVendorParsers.ts` wiring (custom parsers as one more entry in
   `STRUCTURAL_PARSERS`, interpreting a manually-constructed `CustomVendorParser` object —
   no UI yet, backend-only, testable against the same real-library-validation discipline
   `york.ts` just used).
2. The mark-up-one-example UI, FIXED token count only (defer open question 1's variable-
   length span support) — gets the core "no code" value out fastest, accepting it won't
   handle every filename shape.
3. The live coverage-validation view against a real folder/root — this is what makes the
   feature trustworthy rather than a toy; don't ship without it.
4. Code-table editor (optional per field).
5. Variable-length cabinet-token spans (open question 1) once real usage shows fixed-count
   templates are actually the limiting factor, not before.
