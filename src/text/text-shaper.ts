import * as fs from 'fs'

/**
 * HarfBuzz-based text shaper for proper glyph positioning.
 *
 * Uses harfbuzzjs (WebAssembly HarfBuzz port) to run OpenType GSUB and GPOS
 * tables for correct glyph substitution and positioning — essential for Thai
 * floating vowels (สระลอย) and stacked tone marks (วรรณยุกต์ซ้อน).
 *
 * PDFKit already uses fontkit internally which handles basic glyph layout,
 * but HarfBuzz provides the authoritative shaping pipeline (used by Chrome,
 * Firefox, Word, etc.) and is the gold-standard for complex scripts.
 */

/** Cached HarfBuzz instance (initialised lazily) */
let hbInstance: any = null

/** Font blob cache: fontPath → hb blob */
const blobCache = new Map<string, any>()
/** Font face cache: fontPath → hb face */
const faceCache = new Map<string, any>()
/** Font object cache: fontPath+size → hb font */
const fontCache = new Map<string, any>()

/**
 * Initialise the HarfBuzz WASM instance (loaded once, cached).
 */
async function getHb (): Promise<any> {
  if (hbInstance) return hbInstance
  hbInstance = await require('harfbuzzjs')
  return hbInstance
}

/**
 * Get or create a HarfBuzz font for the given path + size.
 */
function getHbFont (hb: any, fontPath: string, fontSize: number): any {
  const key = `${fontPath}@${fontSize}`
  if (fontCache.has(key)) return fontCache.get(key)

  let blob = blobCache.get(fontPath)
  if (!blob) {
    const fontData = fs.readFileSync(fontPath)
    blob = hb.createBlob(fontData)
    blobCache.set(fontPath, blob)
  }

  let face = faceCache.get(fontPath)
  if (!face) {
    face = hb.createFace(blob, 0)
    faceCache.set(fontPath, face)
  }

  const font = hb.createFont(face)
  font.setScale(fontSize * 64, fontSize * 64) // HarfBuzz uses 26.6 fixed point
  fontCache.set(key, font)
  return font
}

/** Result of shaping a string of text */
export interface ShapedGlyph {
  /** Glyph ID in the font */
  g: number
  /** Character cluster index (maps back to input string) */
  cl: number
  /** X advance (in font units ÷ 64 → points) */
  ax: number
  /** Y advance */
  ay: number
  /** X offset from the glyph origin */
  dx: number
  /** Y offset from the glyph origin */
  dy: number
  /** Optional glyph flags */
  fl?: number
}

export class TextShaper {
  /** Whether the async HarfBuzz WASM has been loaded */
  private static ready = false;

  /**
   * Eagerly load the HarfBuzz WASM module.
   * Call this once at startup so that subsequent shapeText() calls are fast.
   */
  static async init (): Promise<void> {
    await getHb()
    TextShaper.ready = true
  }

  /**
   * Segments Thai text into words using Intl.Segmenter.
   * This is crucial for line breaking in Thai, as words are not separated by spaces.
   * @param text The Thai text to segment.
   * @returns An array of segmented words.
   */
  static segmentThaiWords (text: string): string[] {
    const segmenter = new Intl.Segmenter('th-TH', { granularity: 'word' })
    const segments = segmenter.segment(text)
    return Array.from(segments).map(s => s.segment)
  }

  /**
   * Shape text using the HarfBuzz engine for proper glyph positioning.
   *
   * This runs the full OpenType shaping pipeline (GSUB + GPOS) which:
   * - Substitutes glyphs via ligature / contextual rules
   * - Positions marks (Thai tone marks, vowels above/below)
   * - Handles kerning
   *
   * @param text The text to shape.
   * @param fontPath Path to the font file.
   * @param fontSize Font size in points.
   * @returns Array of shaped glyphs with positions.
   */
  static shapeText (text: string, fontPath: string, fontSize: number): ShapedGlyph[] {
    if (!TextShaper.ready || !hbInstance) {
      // Fallback: return empty array (caller should use fontkit's layout)
      return []
    }

    const hb = hbInstance
    const font = getHbFont(hb, fontPath, fontSize)

    const buffer = hb.createBuffer()
    try {
      buffer.addText(text)
      buffer.guessSegmentProperties()
      // Ensure Thai script properties are set
      buffer.setDirection('ltr')

      hb.shape(font, buffer)

      // Use getGlyphInfos/getGlyphPositions instead of buffer.json() because
      // hb_buffer_serialize("JSON") returns an empty string on Linux (WASM
      // serialiser behaves differently across platforms), causing JSON.parse
      // to throw "Unexpected EOF".  The low-level accessors read directly from
      // WASM memory and are portable across all platforms.
      const infos = buffer.getGlyphInfos()
      const positions = buffer.getGlyphPositions()
      return infos.map((info: any, i: number) => {
        const pos = positions[i] ?? { x_advance: 0, y_advance: 0, x_offset: 0, y_offset: 0 }
        return {
          g: info.codepoint,
          cl: info.cluster,
          // Convert from 26.6 fixed point to PDF points
          ax: pos.x_advance / 64,
          ay: pos.y_advance / 64,
          dx: pos.x_offset / 64,
          dy: pos.y_offset / 64,
          fl: info.mask, // glyph flags (HB_GLYPH_FLAG_UNSAFE_TO_BREAK etc.)
        }
      })
    } finally {
      buffer.destroy()
    }
  }

  /**
   * Validate that HarfBuzz shaping produces correct mark positioning
   * for Thai text.  Returns true if the shaped output includes non-zero
   * GPOS offsets (dx/dy), indicating marks were positioned.
   */
  static validateThaiShaping (fontPath: string, fontSize: number = 16): boolean {
    // Test string with stacked marks: ก็, ป้, ฝั่ง
    const test = 'ก็ ป้อม ฝั่ง'
    const glyphs = TextShaper.shapeText(test, fontPath, fontSize)
    if (glyphs.length === 0) return false
    // At least some glyphs should have non-zero dy (mark positioning)
    return glyphs.some(g => g.dy !== 0 || g.dx !== 0)
  }

  // ─── Cluster-based segmentation for Thai justification ──────────

  /** Intl.Segmenter for grapheme cluster splitting (fallback) */
  private static graphemeSegmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });

  /**
   * Split text into segments at HarfBuzz cluster boundaries.
   *
   * Each segment keeps a base consonant together with its combining marks
   * (สระลอย, วรรณยุกต์) — essential for Thai justification so that extra
   * space is distributed between visual character units rather than between
   * words (which are few in Thai and produce ugly wide gaps).
   *
   * Falls back to Unicode grapheme cluster segmentation when HarfBuzz is
   * not available.
   *
   * @param text  The text to segment.
   * @param fontPath  Path to the font file.
   * @param fontSize  Font size in points.
   * @returns Array of text segments (each = one cluster).
   */
  static getClusterSegments (text: string, fontPath: string, fontSize: number): string[] {
    const glyphs = TextShaper.shapeText(text, fontPath, fontSize)
    if (glyphs.length === 0) {
      // Fallback: use Unicode grapheme cluster segmentation
      return TextShaper.getGraphemeSegments(text)
    }

    // Collect unique cluster start indices, preserving first-seen order
    const seen = new Set<number>()
    const clusterStarts: number[] = []
    for (const g of glyphs) {
      if (!seen.has(g.cl)) {
        seen.add(g.cl)
        clusterStarts.push(g.cl)
      }
    }
    // Sort ascending for LTR Thai text
    clusterStarts.sort((a, b) => a - b)

    const segments: string[] = []
    for (let i = 0; i < clusterStarts.length; i++) {
      const start = clusterStarts[i]!
      const end = i + 1 < clusterStarts.length ? clusterStarts[i + 1]! : text.length
      const seg = text.slice(start, end)
      if (seg) segments.push(seg)
    }
    return segments
  }

  /**
   * Fallback: split text into grapheme clusters using Intl.Segmenter.
   * Produces results very similar to HarfBuzz clusters for Thai script.
   */
  static getGraphemeSegments (text: string): string[] {
    return Array.from(TextShaper.graphemeSegmenter.segment(text)).map(s => s.segment)
  }
}
