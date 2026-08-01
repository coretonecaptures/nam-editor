/**
 * How the FX controls arrange themselves at a given panel width.
 *
 * The player is a panel the user drags, with a hard floor of PLAYER_MIN_WIDTH (420px, set by the
 * transport caps in Preview). Sixteen controls stacked one per row is roughly 750px of scrolling,
 * so the layout has to earn back space as the panel widens rather than staying in one column.
 *
 * Widths are DERIVED from a minimum usable control width rather than picked as breakpoints, so
 * changing the padding or the minimum moves every threshold together instead of leaving three
 * magic numbers to drift apart.
 */

export interface FxLayout {
  /** Delay and Chorus side by side, or stacked. */
  cardsPerRow: 1 | 2
  /** Controls per row inside the Delay and Chorus cards. */
  cardControls: number
  /** Controls per row inside the full-width Reverb card. */
  reverbControls: number
  /**
   * Put each control's label, track and value on ONE line.
   *
   * Halves a control's height, at the cost of a shorter track. Only worth it when the panel is
   * too narrow to grid the controls anyway — below that width a stacked label wastes a whole row
   * on text.
   */
  compact: boolean
}

/** Narrowest a labelled slider stays comfortably draggable. */
const MIN_CONTROL_WIDTH = 150
const CONTROL_GAP = 12
const CARD_GAP = 12
/** Card's own inner padding, both sides. */
const CARD_PADDING = 24
/**
 * Narrowest a card may be before going two-up is allowed.
 *
 * Set to whatever holds TWO controls across, and that bound is the whole point. Going side by side
 * halves a card's width, so if each half can only fit one control per row, Delay's seven controls
 * become seven rows and the pair ends up TALLER than the single-column layout it replaced. Two-up
 * has to be an improvement, not a reshuffle.
 */
const MIN_CARD_WIDTH = CARD_PADDING + MIN_CONTROL_WIDTH * 2 + CONTROL_GAP
/** The section's px-4, both sides. */
const PAGE_PADDING = 32
/** Below this the panel is too narrow to grid anything; go single-column and compact instead. */
const COMPACT_BELOW = 560

/** How many controls of at least MIN_CONTROL_WIDTH fit across a card of this outer width. */
function controlsThatFit(cardWidth: number): number {
  const inner = cardWidth - CARD_PADDING
  if (inner <= 0) return 1
  const fit = Math.floor((inner + CONTROL_GAP) / (MIN_CONTROL_WIDTH + CONTROL_GAP))
  return Math.max(1, Math.min(3, fit))
}

export function fxLayoutFor(width: number): FxLayout {
  if (!Number.isFinite(width) || width <= 0) {
    return { cardsPerRow: 1, cardControls: 1, reverbControls: 1, compact: true }
  }

  // Compact mode deliberately forces one control per row: the whole point is a wide, precise
  // track, and a compact row squeezed into a narrow column is the worst of both.
  if (width < COMPACT_BELOW) {
    return { cardsPerRow: 1, cardControls: 1, reverbControls: 1, compact: true }
  }

  const content = width - PAGE_PADDING
  const twoUp = content >= MIN_CARD_WIDTH * 2 + CARD_GAP
  const cardWidth = twoUp ? (content - CARD_GAP) / 2 : content

  return {
    cardsPerRow: twoUp ? 2 : 1,
    cardControls: controlsThatFit(cardWidth),
    reverbControls: controlsThatFit(content),
    compact: false
  }
}

/** CSS grid template for `n` equal control columns. */
export function fxGridTemplate(columns: number): string {
  return `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`
}
