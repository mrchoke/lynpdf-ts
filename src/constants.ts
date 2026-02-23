/** Shared page dimension constants (A4 portrait) */
export const PAGE_W = 595.28   // A4 width in points
export const PAGE_H = 841.89   // A4 height in points
export const PAGE_MARGIN = 50  // Default page margin in points

/**
 * Named page sizes in points [width, height] — portrait orientation.
 * Source: CSS @page spec + ISO 216 standard.
 */
export const NAMED_PAGE_SIZES: Record<string, [number, number]> = {
  a0: [2383.94, 3370.39],
  a1: [1683.78, 2383.94],
  a2: [1190.55, 1683.78],
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  a6: [297.64, 419.53],
  b4: [708.66, 1000.63],
  b5: [498.90, 708.66],
  letter: [612.00, 792.00],
  legal: [612.00, 1008.00],
  ledger: [1224.00, 792.00],
  tabloid: [792.00, 1224.00],
}
