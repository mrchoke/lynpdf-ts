import * as fontkit from 'fontkit'
import * as fs from 'fs'
import * as path from 'path'
import PDFDocument from 'pdfkit'
import SVGtoPDF from 'svg-to-pdfkit'
import { PAGE_H, PAGE_MARGIN, PAGE_W } from '../constants'
import type { ColorSegment, LayoutNode } from '../layout/layout-engine'
import type { FontFaceRule, PageRule } from '../layout/style-resolver'
import { hasEmoji, parseEmojiRuns, preloadEmoji, type TextRun } from '../text/emoji-handler'
import { TextMeasurer } from '../text/text-measurer'
import { TextShaper } from '../text/text-shaper'
import { ColorParser } from './color-parser'

/** Options passed from PDFCreator to the renderer */
export interface RenderOptions {
  /** Enable PDF stream compression (default: true) */
  compress?: boolean
  /** PDF version: '1.3' | '1.4' | '1.5' | '1.6' | '1.7' | '1.7ext3' (default: '1.7') */
  pdfVersion?: string
  /** PDF metadata from HTML <meta> tags or user options */
  info?: {
    Title?: string
    Author?: string
    Subject?: string
    Keywords?: string
    Creator?: string
    Producer?: string
  }
}

/** Registered font families: family name → variant map */
interface FontVariants {
  regular: string
  bold?: string
  italic?: string
  boldItalic?: string
}

export class PDFRenderer {
  // ── Sarabun natural line-height multiplier from font metrics ──
  // (ascent 1068 − descent −232 + lineGap 0) / 1000 = 1.3
  private static NATURAL_LH = 1.3;

  /** Fontkit font cache for glyph checking: fontPath → fontkit.Font */
  private static fontkitCache = new Map<string, fontkit.Font>();

  /** Fallback font file paths (tried in order when primary font lacks a glyph) */
  private static fallbackFontPaths: string[] = [
    'fonts/Inter-Regular.ttf',
    'fonts/NotoEmoji-Regular.ttf',
  ];

  /** PDFKit name corresponding to each fallback path */
  private static fallbackPDFKitNames: string[] = ['Inter', 'NotoEmoji'];

  /** Intl.Segmenter for word-level tokenisation (used by justify) */
  private static wordSegmenter = new Intl.Segmenter('th-TH', { granularity: 'word' });

  /**
   * Check if a line of text is predominantly Thai (> 30% Thai characters).
   * Used to decide whether cluster-based justification should be applied.
   */
  private static isThaiText (text: string): boolean {
    let thaiCount = 0
    let totalCount = 0
    for (const char of text) {
      const cp = char.codePointAt(0)!
      if (cp > 0x20) {
        totalCount++
        if (cp >= 0x0E00 && cp <= 0x0E7F) thaiCount++
      }
    }
    return totalCount > 0 && thaiCount / totalCount > 0.3
  }

  /**
   * Get cluster-level justify tokens for Thai text using HarfBuzz
   * cluster boundaries.  Also returns a set of token indices that
   * coincide with word boundaries (for weighted gap distribution).
   *
   * The key insight: Thai words are not separated by spaces, so word-level
   * tokenisation yields very few break points → excessively wide gaps.
   * Cluster-level tokenisation provides many more break points (one per
   * base consonant + combining marks) with much smaller gaps.
   *
   * Word boundaries still receive extra weight (3×) so the text retains
   * a natural reading rhythm.
   */
  private static getThaiClusterTokens (
    line: string,
    fontPath: string,
    fontSize: number,
  ): { tokens: string[]; wordBoundaryIndices: Set<number> } {
    // Get fine-grained cluster segments from HarfBuzz (or grapheme fallback)
    const clusters = TextShaper.getClusterSegments(line, fontPath, fontSize)
    if (clusters.length <= 1) {
      return { tokens: clusters, wordBoundaryIndices: new Set() }
    }

    // Build set of character positions that are word boundaries
    const wordBoundaryChars = new Set<number>()
    const wordSegments = Array.from(PDFRenderer.wordSegmenter.segment(line))
    let charPos = 0
    for (const seg of wordSegments) {
      if (charPos > 0 && seg.isWordLike) {
        wordBoundaryChars.add(charPos)
      }
      charPos += seg.segment.length
    }

    // Map cluster indices → which ones are at word boundaries
    const wordBoundaryIndices = new Set<number>()
    let clusterCharPos = 0
    for (let i = 0; i < clusters.length; i++) {
      if (wordBoundaryChars.has(clusterCharPos)) {
        wordBoundaryIndices.add(i)
      }
      clusterCharPos += clusters[i]!.length
    }

    return { tokens: clusters, wordBoundaryIndices }
  }

  /**
   * Split a single line of text into word-level tokens for justification.
   * Spaces are removed (they become flexible gaps); punctuation sticks to
   * the preceding word.
   */
  private static getJustifyTokens (line: string): string[] {
    const segments = Array.from(PDFRenderer.wordSegmenter.segment(line))
    const tokens: string[] = []
    let current = ''

    for (const seg of segments) {
      if (seg.isWordLike) {
        // Each word-like segment starts a new token
        if (current && current.trim().length > 0) {
          tokens.push(current)
          current = ''
        }
        current += seg.segment
      } else if (/^\s+$/.test(seg.segment)) {
        // Whitespace: flush current token — the space becomes a gap
        if (current) {
          tokens.push(current)
          current = ''
        }
      } else {
        // Punctuation: attach to the current token
        current += seg.segment
      }
    }
    if (current) tokens.push(current)
    return tokens
  }

  /**
   * Render text with manual justification.  Splits the pre-wrapped text
   * (which already contains \n line-breaks from wrapText()) into lines,
   * then distributes the remaining horizontal space evenly between
   * word-level tokens on every line except the last.
   */
  private static renderJustifiedText (
    doc: PDFKit.PDFDocument,
    text: string,
    x: number,
    y: number,
    containerWidth: number,
    fontSize: number,
    lineGap: number,
    fontName: string,
    fontPath: string,
    primaryFontName: string,
  ): void {
    const lines = text.split('\n')
    const lineH = fontSize * PDFRenderer.NATURAL_LH + lineGap
    let cy = y

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (!line || !line.trim()) {
        cy += lineH
        continue
      }

      const isLastLine = i === lines.length - 1

      // Handle glyph fallback per line
      const glyphRuns = PDFRenderer.splitByGlyphAvailability(line, fontPath, primaryFontName)
      const needsFallback = glyphRuns.length > 1 || (glyphRuns.length === 1 && glyphRuns[0]?.fontName !== primaryFontName)

      if (isLastLine || needsFallback) {
        // Last line → left-aligned (standard justify behaviour)
        // Fallback lines → render with font switching, no justify
        if (!needsFallback) {
          doc.font(fontName)
            .text(line, x, cy, { lineBreak: false })
        } else {
          let cx = x
          for (const run of glyphRuns) {
            doc.font(run.fontName)
            doc.text(run.text, cx, cy, { lineBreak: false })
            cx += doc.widthOfString(run.text)
          }
        }
        cy += lineH
        continue
      }

      // Tokenise line for justification
      const tokens = PDFRenderer.getJustifyTokens(line)

      if (tokens.length <= 1) {
        // Single token — nothing to justify
        doc.font(fontName)
          .text(line, x, cy, { lineBreak: false })
        cy += lineH
        continue
      }

      // Measure natural width of each token
      doc.font(fontName)
      const tokenWidths = tokens.map(t => doc.widthOfString(t))
      const totalTextWidth = tokenWidths.reduce((sum, w) => sum + w, 0)
      const remainingSpace = containerWidth - totalTextWidth

      if (remainingSpace <= 0) {
        doc.text(line, x, cy, { lineBreak: false })
        cy += lineH
        continue
      }

      const gapCount = tokens.length - 1
      const gapSize = remainingSpace / gapCount

      // ── Thai cluster-based justification ────────────────────────
      // When word-level gaps are too wide for Thai text, switch to
      // HarfBuzz cluster boundaries for much finer space distribution.
      // Word boundaries receive 3× the weight of intra-word cluster
      // boundaries so the text retains a natural reading rhythm.
      const THAI_CLUSTER_GAP_THRESHOLD = fontSize * 0.6
      if (gapSize > THAI_CLUSTER_GAP_THRESHOLD && PDFRenderer.isThaiText(line)) {
        const { tokens: clusterTokens, wordBoundaryIndices } =
          PDFRenderer.getThaiClusterTokens(line, fontPath, fontSize)

        if (clusterTokens.length > tokens.length) {
          doc.font(fontName)
          const clusterWidths = clusterTokens.map(t => doc.widthOfString(t))
          const clusterTotalWidth = clusterWidths.reduce((s, w) => s + w, 0)
          const clusterRemaining = containerWidth - clusterTotalWidth

          if (clusterRemaining > 0 && clusterTokens.length > 1) {
            // Two-tier weighting: word boundaries 3×, cluster boundaries 1×
            const WORD_WEIGHT = 3
            const CLUSTER_WEIGHT = 1
            let totalWeight = 0
            for (let j = 1; j < clusterTokens.length; j++) {
              totalWeight += wordBoundaryIndices.has(j) ? WORD_WEIGHT : CLUSTER_WEIGHT
            }

            const unitGap = clusterRemaining / totalWeight

            let cx = x
            for (let j = 0; j < clusterTokens.length; j++) {
              doc.text(clusterTokens[j]!, cx, cy, { lineBreak: false })
              cx += clusterWidths[j]!
              if (j < clusterTokens.length - 1) {
                const weight = wordBoundaryIndices.has(j + 1) ? WORD_WEIGHT : CLUSTER_WEIGHT
                cx += unitGap * weight
              }
            }
            cy += lineH
            continue
          }
        }
      }

      // ── Standard word-gap justification (non-Thai / fallback) ───
      // When gap between words would be excessively wide (>2× font size),
      // redistribute some space as letter-spacing to keep text natural.
      const maxGap = fontSize * 2
      const useCharSpacing = gapSize > maxGap && tokens.length > 1
      let actualGap = gapSize
      let charSpacing = 0

      if (useCharSpacing) {
        // Count total characters across all tokens (for letter-spacing)
        const totalChars = tokens.reduce((s, t) => s + [...t].length, 0)
        const charSpacingSlots = Math.max(1, totalChars - tokens.length) // slots between chars within tokens
        // Allocate up to half the excess as letter-spacing
        const excessPerGap = gapSize - maxGap
        const totalExcess = excessPerGap * gapCount
        const charSpacingTotal = Math.min(totalExcess * 0.5, charSpacingSlots * fontSize * 0.15)
        charSpacing = charSpacingTotal / charSpacingSlots
        // Recalculate gaps after applying letter-spacing
        const newTextWidth = totalTextWidth + charSpacing * charSpacingSlots
        actualGap = (containerWidth - newTextWidth) / gapCount
      }

      let cx = x
      for (let j = 0; j < tokens.length; j++) {
        const textOpts: PDFKit.Mixins.TextOptions & { characterSpacing?: number } = { lineBreak: false }
        if (charSpacing > 0) {
          textOpts.characterSpacing = charSpacing
        }
        doc.text(tokens[j]!, cx, cy, textOpts)
        const tokenW = charSpacing > 0
          ? doc.widthOfString(tokens[j]!, { characterSpacing: charSpacing } as any)
          : doc.widthOfString(tokens[j]!)
        cx += tokenW
        if (j < tokens.length - 1) cx += actualGap
      }

      cy += lineH
    }
  }

  /** Load a fontkit.Font, cached */
  private static getFontkitFont (fontPath: string): fontkit.Font | null {
    let font = PDFRenderer.fontkitCache.get(fontPath)
    if (font) return font
    try {
      font = fontkit.openSync(fontPath)
      PDFRenderer.fontkitCache.set(fontPath, font)
      return font
    } catch {
      return null
    }
  }

  /**
   * Split an array of ColorSegments into lines.
   * Each segment may contain '\n' characters; this splits them so that
   * the result is an array of lines, each line being an array of segments.
   */
  private static splitSegmentsIntoLines (segments: ColorSegment[]): ColorSegment[][] {
    const lines: ColorSegment[][] = [[]]
    for (const seg of segments) {
      const parts = seg.text.split('\n')
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) lines.push([])   // start a new line
        const text = parts[i]!
        if (text) {
          lines[lines.length - 1]!.push({ text, color: seg.color })
        }
      }
    }
    // Trim leading/trailing empty lines (from HTML formatting)
    while (lines.length > 0 && lines[0]!.length === 0) lines.shift()
    while (lines.length > 0 && lines[lines.length - 1]!.length === 0) lines.pop()
    return lines
  }

  /**
   * Split text into runs, substituting a fallback font for characters
   * missing from the primary font.  Returns an array of { text, fontName }.
   */
  private static splitByGlyphAvailability (
    text: string,
    primaryFontPath: string,
    primaryFontName: string,
  ): { text: string; fontName: string }[] {
    const primaryFont = PDFRenderer.getFontkitFont(primaryFontPath)
    if (!primaryFont) return [{ text, fontName: primaryFontName }]

    const runs: { text: string; fontName: string }[] = []
    let currentText = ''
    let currentFont = primaryFontName

    for (const char of text) {
      const codePoint = char.codePointAt(0)!
      // Skip basic ASCII & Thai block — assume primary font has them
      if (codePoint < 0x0100 || (codePoint >= 0x0E00 && codePoint <= 0x0E7F)) {
        if (currentFont !== primaryFontName) {
          if (currentText) runs.push({ text: currentText, fontName: currentFont })
          currentText = ''
          currentFont = primaryFontName
        }
        currentText += char
        continue
      }

      // Check if primary font has the glyph
      if ((primaryFont as any).hasGlyphForCodePoint(codePoint)) {
        if (currentFont !== primaryFontName) {
          if (currentText) runs.push({ text: currentText, fontName: currentFont })
          currentText = ''
          currentFont = primaryFontName
        }
        currentText += char
        continue
      }

      // Try fallback fonts
      let found = false
      for (let i = 0; i < PDFRenderer.fallbackFontPaths.length; i++) {
        const fbPath = PDFRenderer.fallbackFontPaths[i]!
        const fb = PDFRenderer.getFontkitFont(fbPath)
        if (fb && (fb as any).hasGlyphForCodePoint(codePoint)) {
          const fbName = PDFRenderer.fallbackPDFKitNames[i]!
          if (currentFont !== fbName) {
            if (currentText) runs.push({ text: currentText, fontName: currentFont })
            currentText = ''
            currentFont = fbName
          }
          currentText += char
          found = true
          break
        }
      }
      if (!found) {
        // No fallback found — keep in primary font (will render as .notdef)
        if (currentFont !== primaryFontName) {
          if (currentText) runs.push({ text: currentText, fontName: currentFont })
          currentText = ''
          currentFont = primaryFontName
        }
        currentText += char
      }
    }
    if (currentText) runs.push({ text: currentText, fontName: currentFont })
    return runs
  }

  /** Map of font-family names (lowercase, no quotes) → font variants */
  private static registeredFonts: Map<string, FontVariants> = new Map([
    // ── Thai fonts (real files) ──
    ['sarabun', { regular: 'Sarabun', bold: 'Sarabun-Bold', italic: 'Sarabun-Italic', boldItalic: 'Sarabun-BoldItalic' }],
    ['prompt', { regular: 'Prompt', bold: 'Prompt-Bold', italic: 'Prompt-Italic', boldItalic: 'Prompt-BoldItalic' }],
    ['kanit', { regular: 'Kanit', bold: 'Kanit-Bold', italic: 'Kanit-Italic', boldItalic: 'Kanit-BoldItalic' }],
    ['mitr', { regular: 'Mitr', bold: 'Mitr-Bold' }],
    ['chakra petch', { regular: 'ChakraPetch', bold: 'ChakraPetch-Bold', italic: 'ChakraPetch-Italic', boldItalic: 'ChakraPetch-BoldItalic' }],
    ['chakrapetch', { regular: 'ChakraPetch', bold: 'ChakraPetch-Bold', italic: 'ChakraPetch-Italic', boldItalic: 'ChakraPetch-BoldItalic' }],
    // ── TLWG Thai fonts (OTF) ──
    ['garuda', { regular: 'Garuda', bold: 'Garuda-Bold', italic: 'Garuda-Oblique', boldItalic: 'Garuda-BoldOblique' }],
    ['loma', { regular: 'Loma', bold: 'Loma-Bold', italic: 'Loma-Oblique', boldItalic: 'Loma-BoldOblique' }],
    ['norasi', { regular: 'Norasi', bold: 'Norasi-Bold', italic: 'Norasi-Italic', boldItalic: 'Norasi-BoldItalic' }],
    ['kinnari', { regular: 'Kinnari', bold: 'Kinnari-Bold', italic: 'Kinnari-Italic', boldItalic: 'Kinnari-BoldItalic' }],
    ['sawasdee', { regular: 'Sawasdee', bold: 'Sawasdee-Bold', italic: 'Sawasdee-Oblique', boldItalic: 'Sawasdee-BoldOblique' }],
    ['laksaman', { regular: 'Laksaman', bold: 'Laksaman-Bold', italic: 'Laksaman-Italic', boldItalic: 'Laksaman-BoldItalic' }],
    ['purisa', { regular: 'Purisa', bold: 'Purisa-Bold', italic: 'Purisa-Oblique', boldItalic: 'Purisa-BoldOblique' }],
    ['umpush', { regular: 'Umpush', bold: 'Umpush-Bold', italic: 'Umpush-Oblique', boldItalic: 'Umpush-BoldOblique' }],
    ['waree', { regular: 'Waree', bold: 'Waree-Bold', italic: 'Waree-Oblique', boldItalic: 'Waree-BoldOblique' }],
    ['tlwgmono', { regular: 'TlwgMono', bold: 'TlwgMono-Bold' }],
    ['tlwg mono', { regular: 'TlwgMono', bold: 'TlwgMono-Bold' }],
    ['tlwgtypewriter', { regular: 'TlwgTypewriter', bold: 'TlwgTypewriter-Bold' }],
    ['tlwg typewriter', { regular: 'TlwgTypewriter', bold: 'TlwgTypewriter-Bold' }],
    ['tlwgtypist', { regular: 'TlwgTypist', bold: 'TlwgTypist-Bold' }],
    ['tlwg typist', { regular: 'TlwgTypist', bold: 'TlwgTypist-Bold' }],
    ['tlwgtypo', { regular: 'TlwgTypo', bold: 'TlwgTypo-Bold' }],
    ['tlwg typo', { regular: 'TlwgTypo', bold: 'TlwgTypo-Bold' }],
    // ── Inter (TTF – excellent kerning & ligatures) ──
    ['inter', { regular: 'Inter', bold: 'Inter-Bold', italic: 'Inter-Italic', boldItalic: 'Inter-BoldItalic' }],
    // ── IBM Plex Sans (OTF – ligatures & kerning) ──
    ['ibm plex sans', { regular: 'IBMPlexSans', bold: 'IBMPlexSans-Bold', italic: 'IBMPlexSans-Italic' }],
    ['ibm plex', { regular: 'IBMPlexSans', bold: 'IBMPlexSans-Bold', italic: 'IBMPlexSans-Italic' }],
    // ── Inter Variable (single font file, multiple weights via variation) ──
    ['inter variable', { regular: 'InterVariable', bold: 'InterVariable', italic: 'InterVariable-Italic', boldItalic: 'InterVariable-Italic' }],
    ['intervariable', { regular: 'InterVariable', bold: 'InterVariable', italic: 'InterVariable-Italic', boldItalic: 'InterVariable-Italic' }],
    // ── Generic fallback → Sarabun ──
    ['sans-serif', { regular: 'Sarabun', bold: 'Sarabun-Bold', italic: 'Sarabun-Italic', boldItalic: 'Sarabun-BoldItalic' }],
    ['serif', { regular: 'Sarabun', bold: 'Sarabun-Bold', italic: 'Sarabun-Italic', boldItalic: 'Sarabun-BoldItalic' }],
    ['monospace', { regular: 'Sarabun', bold: 'Sarabun-Bold', italic: 'Sarabun-Italic', boldItalic: 'Sarabun-BoldItalic' }],
    ['system-ui', { regular: 'Sarabun', bold: 'Sarabun-Bold', italic: 'Sarabun-Italic', boldItalic: 'Sarabun-BoldItalic' }],
    // ── Web fonts that fall back to Sarabun ──
    ['noto sans', { regular: 'Sarabun', bold: 'Sarabun-Bold', italic: 'Sarabun-Italic', boldItalic: 'Sarabun-BoldItalic' }],
    ['noto sans thai', { regular: 'Sarabun', bold: 'Sarabun-Bold', italic: 'Sarabun-Italic', boldItalic: 'Sarabun-BoldItalic' }],
    ['open sans', { regular: 'Sarabun', bold: 'Sarabun-Bold', italic: 'Sarabun-Italic', boldItalic: 'Sarabun-BoldItalic' }],
    ['roboto', { regular: 'Sarabun', bold: 'Sarabun-Bold', italic: 'Sarabun-Italic', boldItalic: 'Sarabun-BoldItalic' }],
    ['arial', { regular: 'Sarabun', bold: 'Sarabun-Bold', italic: 'Sarabun-Italic', boldItalic: 'Sarabun-BoldItalic' }],
    ['helvetica', { regular: 'Sarabun', bold: 'Sarabun-Bold', italic: 'Sarabun-Italic', boldItalic: 'Sarabun-BoldItalic' }],
  ]);

  /**
   * Resolve PDFKit font name from CSS font-family, weight, and style.
   * Falls back to Sarabun if the font family is not registered.
   */
  private static resolveFontName (styles: Record<string, string>): string {
    const isBold = styles['font-weight'] === 'bold' || parseInt(styles['font-weight'] || '400', 10) >= 700
    const isItalic = styles['font-style'] === 'italic'

    // Parse font-family list, try each in order
    const familyRaw = styles['font-family'] || 'Sarabun'
    const families = familyRaw.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase())

    let variants: FontVariants | undefined
    for (const family of families) {
      if (PDFRenderer.registeredFonts.has(family)) {
        variants = PDFRenderer.registeredFonts.get(family)!
        break
      }
    }
    // Default to Sarabun if nothing matched
    if (!variants) variants = PDFRenderer.registeredFonts.get('sarabun')!

    if (isBold && isItalic && variants.boldItalic) return variants.boldItalic
    if (isBold && variants.bold) return variants.bold
    if (isItalic && variants.italic) return variants.italic
    return variants.regular
  }

  /**
   * Parse CSS border-radius value → numeric radius in points.
   * Supports `10px`, `20`, and `50%` (computed as half the smaller dimension).
   */
  private static parseBorderRadius (value: string | undefined, width: number, height: number): number {
    if (!value || value === '0' || value === '0px') return 0
    if (value.endsWith('%')) {
      return Math.min(width, height) * parseFloat(value) / 100
    }
    const v = parseFloat(value)
    return isNaN(v) ? 0 : v
  }

  /**
   * Draw all applicable borders for a node (supports border shorthand +
   * individual border-top/right/bottom/left, border-radius, border-collapse).
   */
  private static drawBorders (doc: PDFKit.PDFDocument, node: LayoutNode, localY: number): void {
    const styles = node.styles

    // Parse a "1px solid #color" shorthand or undefined
    const parseBorderShorthand = (val: string | undefined): { width: number; color: string; opacity: number; style: string } | null => {
      if (!val || val === 'none') return null
      const parts = val.trim().split(/\s+/)
      const w = parseFloat(parts[0] ?? '1') || 1
      // Detect border style: "1px dashed #color" or "1px solid #color"
      let borderStyle = 'solid'
      let colorIdx = 1
      if (parts[1] && /^(solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(parts[1])) {
        borderStyle = parts[1]
        colorIdx = 2
      }
      const colorPart = parts[colorIdx] ?? parts[1] ?? '#000'
      const parsed = ColorParser.parse(colorPart)
      if (!parsed) return null
      return { width: w, color: parsed.color, opacity: parsed.opacity, style: borderStyle }
    }

    /** Apply dash pattern to PDFKit doc based on border style */
    const applyDash = (d: PDFKit.PDFDocument, borderStyle: string, lineWidth: number) => {
      if (borderStyle === 'dashed') {
        (d as any).dash(lineWidth * 4, { space: lineWidth * 3 })
      } else if (borderStyle === 'dotted') {
        (d as any).dash(lineWidth, { space: lineWidth * 2 })
      } else {
        (d as any).undash()
      }
    }

    const allBorder = parseBorderShorthand(styles['border'])
    const radius = PDFRenderer.parseBorderRadius(styles['border-radius'], node.width, node.height)

    // Border-collapse: skip shared borders for non-first cells/rows
    const isCollapsed = styles['border-collapse'] === 'collapse' && (node.tagName === 'td' || node.tagName === 'th')
    const cellIdx = parseInt(styles['_cellIndex'] ?? '-1', 10)
    const rowIdx = parseInt(styles['_rowIndex'] ?? '-1', 10)

    // If we have a uniform border and radius, draw a single rounded rect
    if (radius > 0 && allBorder) {
      const hw = allBorder.width / 2
      doc.save()
      applyDash(doc, allBorder.style, allBorder.width)
      doc.strokeOpacity(allBorder.opacity)
        .lineWidth(allBorder.width)
        .roundedRect(node.x + hw, localY + hw, node.width - allBorder.width, node.height - allBorder.width, Math.max(0, radius - hw))
        .stroke(allBorder.color);
      (doc as any).undash()
      doc.restore()
      return
    }

    // Parse individual border sides
    const borderTop = parseBorderShorthand(styles['border-top']) ?? allBorder
    const borderRight = parseBorderShorthand(styles['border-right']) ?? allBorder
    const borderBottom = parseBorderShorthand(styles['border-bottom']) ?? allBorder
    const borderLeft = parseBorderShorthand(styles['border-left']) ?? allBorder

    // Border-collapse: skip shared borders for non-first cells/rows
    const drawTop = borderTop && !(isCollapsed && rowIdx > 0)
    const drawRight = borderRight && true
    const drawBottom = borderBottom && true
    const drawLeft = borderLeft && !(isCollapsed && cellIdx > 0)

    // Check if all drawn borders are the same style
    const drawnBorders = [
      drawTop ? borderTop : null,
      drawRight ? borderRight : null,
      drawBottom ? borderBottom : null,
      drawLeft ? borderLeft : null,
    ].filter(Boolean) as { width: number; color: string; opacity: number; style: string }[]

    const first = drawnBorders[0]
    const allSame = drawnBorders.length > 0 && first != null
      && drawnBorders.every(b => b.width === first.width
        && b.color === first.color
        && b.opacity === first.opacity
        && b.style === first.style)

    // If all 4 borders are drawn AND same style, use a single rect for perfect corners
    if (drawTop && drawRight && drawBottom && drawLeft && allSame && first) {
      const hw = first.width / 2
      doc.save()
      applyDash(doc, first.style, first.width)
      doc.strokeOpacity(first.opacity)
        .lineWidth(first.width)
        .rect(node.x + hw, localY + hw, node.width - first.width, node.height - first.width)
        .stroke(first.color);
      (doc as any).undash()
      doc.restore()
      return
    }

    // Draw individual sides — inset by half lineWidth so strokes align to
    // the element boundary and adjacent elements' borders overlap cleanly.
    const x = node.x
    const y = localY
    const w = node.width
    const h = node.height

    const drawSide = (b: { width: number; color: string; opacity: number; style: string },
      x1: number, y1: number, x2: number, y2: number) => {
      doc.save()
      applyDash(doc, b.style, b.width)
      doc.strokeOpacity(b.opacity)
        .lineWidth(b.width)
        .lineCap(b.style === 'dotted' ? 'round' : 'square')
        .moveTo(x1, y1)
        .lineTo(x2, y2)
        .stroke(b.color);
      (doc as any).undash()
      doc.restore()
    }

    // Use half-lineWidth insets so strokes sit exactly on the element boundary
    const topHW = borderTop ? borderTop.width / 2 : 0
    const rightHW = borderRight ? borderRight.width / 2 : 0
    const bottomHW = borderBottom ? borderBottom.width / 2 : 0
    const leftHW = borderLeft ? borderLeft.width / 2 : 0

    if (drawTop && borderTop) drawSide(borderTop, x, y + topHW, x + w, y + topHW)
    if (drawRight && borderRight) drawSide(borderRight, x + w - rightHW, y, x + w - rightHW, y + h)
    if (drawBottom && borderBottom) drawSide(borderBottom, x, y + h - bottomHW, x + w, y + h - bottomHW)
    if (drawLeft && borderLeft) drawSide(borderLeft, x + leftHW, y, x + leftHW, y + h)
  }

  /**
   * Renders the calculated layout tree into a PDF file.
   * @param layout The layout tree with positions and dimensions.
   * @param outputPath The path to save the generated PDF.
   * @param pageRules The @page rules for headers and footers.
   */
  /**
   * Resolve the font file path from CSS styles (for text measurement in renderer).
   */
  private static resolveFontPath (styles: Record<string, string>): string {
    const isBold = styles['font-weight'] === 'bold' || parseInt(styles['font-weight'] || '400', 10) >= 700
    const isItalic = styles['font-style'] === 'italic'
    if (isBold && isItalic) return 'fonts/Sarabun-BoldItalic.ttf'
    if (isBold) return 'fonts/Sarabun-Bold.ttf'
    if (isItalic) return 'fonts/Sarabun-Italic.ttf'
    return 'fonts/Sarabun-Regular.ttf'
  }

  async render (layout: LayoutNode, outputPath: string, pageRules: PageRule[] = [], options: RenderOptions = {}, fontFaceRules: FontFaceRule[] = [], pageMargin: number = PAGE_MARGIN, pageWidth: number = PAGE_W, pageHeight: number = PAGE_H): Promise<void> {
    // Local page-dimension constants — shadow module-level PAGE_H/PAGE_W so
    // all existing code in this method automatically uses the resolved dimensions.
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const PAGE_W = pageWidth   // effective page width for this render
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const PAGE_H = pageHeight  // effective page height for this render
    // Shared TextMeasurer for pre-wrapping Thai text in the renderer
    const textMeasurer = new TextMeasurer('fonts/Sarabun-Regular.ttf')

    // Initialise HarfBuzz WASM for proper Thai glyph shaping
    try { await TextShaper.init() } catch { /* proceed without HarfBuzz */ }

    // ── Pre-render: collect all text nodes and download emoji PNGs ──
    const allTexts: string[] = []
    const collectTexts = (node: LayoutNode) => {
      if (node.type === 'text' && node.content) {
        allTexts.push(node.content)
      }
      for (const child of node.children) collectTexts(child)
    }
    collectTexts(layout)
    await preloadEmoji(allTexts)

    // Build a map of text nodes → their parsed emoji runs
    const emojiRunMap = new Map<LayoutNode, TextRun[]>()
    const processEmojiRuns = async (node: LayoutNode) => {
      if (node.type === 'text' && node.content && hasEmoji(node.content)) {
        emojiRunMap.set(node, await parseEmojiRuns(node.content))
      }
      for (const child of node.children) await processEmojiRuns(child)
    }
    await processEmojiRuns(layout)

    // ── Pre-render: build id → position map for internal links ──
    const idMap = new Map<string, { x: number; y: number; page: number }>()
    const buildIdMap = (node: LayoutNode) => {
      if (node.attrs && node.attrs['id']) {
        const page = Math.floor(node.y / PAGE_H)
        const localY = node.y - page * PAGE_H
        idMap.set(node.attrs['id'], { x: node.x, y: localY, page })
      }
      for (const child of node.children) buildIdMap(child)
    }
    buildIdMap(layout)

    // ── Pre-render: build table → thead/tfoot map for repeating headers/footers ──
    interface TheadInfo {
      theadNode: LayoutNode
      theadHeight: number
      tableX: number
      theadContentPages: Set<number>
    }
    interface TfootInfo {
      tfootNode: LayoutNode
      tfootHeight: number
      tableX: number
    }
    const tableTheadMap = new Map<LayoutNode, TheadInfo>()
    const tableTfootMap = new Map<LayoutNode, TfootInfo>()
    const findTableTheads = (node: LayoutNode) => {
      if (node.tagName === 'table') {
        const thead = node.children.find(c => c.tagName === 'thead')
        if (thead) {
          // Check CSS opt-out: -lynpdf-repeat: none on thead or table
          const theadRepeat = thead.styles['-lynpdf-repeat'] || node.styles['-lynpdf-repeat']
          if (theadRepeat !== 'none') {
            const theadHeight = thead.height
            // Compute which pages actually contain thead rows (after page-break
            // shifts the container y may be stale — use first TR's position).
            const theadRows = thead.children.filter(c => c.tagName === 'tr')
            const theadContentPages = new Set<number>(
              theadRows.map(r => Math.floor(r.y / PAGE_H)),
            )
            tableTheadMap.set(node, {
              theadNode: thead, theadHeight, tableX: node.x,
              theadContentPages,
            })
          }
        }
        const tfoot = node.children.find(c => c.tagName === 'tfoot')
        if (tfoot) {
          const tfootHeight = tfoot.height
          tableTfootMap.set(node, { tfootNode: tfoot, tfootHeight, tableX: node.x })
        }
      }
      for (const child of node.children) findTableTheads(child)
    }
    findTableTheads(layout)

    // ── Pre-render: collect nodes with position: fixed ──
    const fixedNodes: LayoutNode[] = []
    const collectFixedNodes = (node: LayoutNode) => {
      if (node.styles['position'] === 'fixed') {
        fixedNodes.push(node)
      } else {
        for (const child of node.children) collectFixedNodes(child)
      }
    }
    collectFixedNodes(layout)

    // ── Pre-render: resolve @font-face sources (download remote, resolve local) ──
    // This runs in the async context before the Promise callback.
    interface ResolvedFontFace {
      family: string
      fontPath: string
      weight: string
      style: string
    }
    const resolvedFontFaces: ResolvedFontFace[] = []

    if (fontFaceRules.length > 0) {
      const fontCacheDir = path.join(
        (typeof process !== 'undefined' && process.env?.HOME) || '/tmp',
        '.cache', 'lynpdf', 'fonts',
      )

      for (const rule of fontFaceRules) {
        const src = rule.src
        let fontPath = ''

        if (src.startsWith('http://') || src.startsWith('https://')) {
          // Remote font → download to cache
          try {
            fs.mkdirSync(fontCacheDir, { recursive: true })
            const safeName = src.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120)
            const cachedPath = path.join(fontCacheDir, safeName)
            if (!fs.existsSync(cachedPath)) {
              const resp = await fetch(src)
              if (resp.ok) {
                const buf = Buffer.from(await resp.arrayBuffer())
                fs.writeFileSync(cachedPath, buf)
              }
            }
            if (fs.existsSync(cachedPath)) {
              fontPath = cachedPath
            }
          } catch { /* skip this font */ }
        } else if (src.startsWith('file://')) {
          fontPath = src.replace(/^file:\/\//, '')
        } else {
          fontPath = src
        }

        if (fontPath && fs.existsSync(fontPath)) {
          resolvedFontFaces.push({
            family: rule.family,
            fontPath,
            weight: rule.weight,
            style: rule.style,
          })
        }
      }
    }

    return new Promise((resolve, reject) => {
      // Initialize PDFKit document — margin: 0 because Yoga handles all spacing.
      // This prevents PDFKit from auto-adding pages when text is near the bottom.
      const compress = options.compress !== false // default: true
      const pdfVersion = options.pdfVersion || '1.7'
      const info: Record<string, string> = {
        Creator: 'LynPDF',
        Producer: 'LynPDF (PDFKit)',
        ...options.info,
      }
      const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, bufferPages: true, compress, pdfVersion, info } as any)
      const stream = fs.createWriteStream(outputPath)

      doc.pipe(stream);

      // ── Patch: use rg/RG/k/K shorthand color operators ──────────
      // PDFKit normally writes `/DeviceRGB cs` then `scn`/`SCN` to set colors.
      // Some PDF viewers (particularly macOS Preview) mishandle scn and
      // render inverted (complement) colors.  The shorthand operators
      // rg / RG (and k / K for CMYK) are universally supported and avoid
      // the separate color-space declaration entirely.
      (doc as any)._setColorCore = function (color: any, stroke: boolean) {
        color = this._normalizeColor(color)
        if (!color) return false
        if (Array.isArray(color)) {
          const op = color.length === 4
            ? (stroke ? 'K' : 'k')       // DeviceCMYK
            : (stroke ? 'RG' : 'rg')    // DeviceRGB
          this.addContent(`${color.join(' ')} ${op}`)
          return true
        }
        // SpotColor fallback — keep original cs + scn approach
        const csOp = stroke ? 'SCN' : 'scn'
        const space = this._getColorSpace(color)
        this._setColorSpace(space, stroke)
        this.page.colorSpaces[color.id] = color.ref
        this.addContent(`1 ${csOp}`)
        return true
      }

      // Draw explicit white background on a page (prevents black background
      // in viewers where the default transparent page appears as black).
      const drawWhiteBackground = () => {
        doc.save()
        doc.addContent('1 1 1 rg')
        doc.rect(0, 0, PAGE_W, PAGE_H)
        doc.addContent('f')
        doc.restore()
      }

      // White background on the first page (created by new PDFDocument).
      drawWhiteBackground()

      // Register fonts
      doc.registerFont('Sarabun', 'fonts/Sarabun-Regular.ttf')
      doc.registerFont('Sarabun-Bold', 'fonts/Sarabun-Bold.ttf')
      doc.registerFont('Sarabun-Italic', 'fonts/Sarabun-Italic.ttf')
      doc.registerFont('Sarabun-BoldItalic', 'fonts/Sarabun-BoldItalic.ttf')

      doc.registerFont('Prompt', 'fonts/Prompt-Regular.ttf')
      doc.registerFont('Prompt-Bold', 'fonts/Prompt-Bold.ttf')
      doc.registerFont('Prompt-Italic', 'fonts/Prompt-Italic.ttf')
      doc.registerFont('Prompt-BoldItalic', 'fonts/Prompt-BoldItalic.ttf')

      doc.registerFont('Kanit', 'fonts/Kanit-Regular.ttf')
      doc.registerFont('Kanit-Bold', 'fonts/Kanit-Bold.ttf')
      doc.registerFont('Kanit-Italic', 'fonts/Kanit-Italic.ttf')
      doc.registerFont('Kanit-BoldItalic', 'fonts/Kanit-BoldItalic.ttf')

      doc.registerFont('Mitr', 'fonts/Mitr-Regular.ttf')
      doc.registerFont('Mitr-Bold', 'fonts/Mitr-Bold.ttf')

      doc.registerFont('ChakraPetch', 'fonts/ChakraPetch-Regular.ttf')
      doc.registerFont('ChakraPetch-Bold', 'fonts/ChakraPetch-Bold.ttf')
      doc.registerFont('ChakraPetch-Italic', 'fonts/ChakraPetch-Italic.ttf')
      doc.registerFont('ChakraPetch-BoldItalic', 'fonts/ChakraPetch-BoldItalic.ttf')

      doc.registerFont('NotoEmoji', 'fonts/NotoEmoji-Regular.ttf')

      // ── Inter (TTF – excellent kerning & ligatures) ──
      doc.registerFont('Inter', 'fonts/Inter-Regular.ttf')
      doc.registerFont('Inter-Bold', 'fonts/Inter-Bold.ttf')
      doc.registerFont('Inter-Italic', 'fonts/Inter-Italic.ttf')
      doc.registerFont('Inter-BoldItalic', 'fonts/Inter-BoldItalic.ttf')

      // ── IBM Plex Sans (OTF – ligatures & kerning) ──
      doc.registerFont('IBMPlexSans', 'fonts/IBMPlexSans-Regular.otf')
      doc.registerFont('IBMPlexSans-Bold', 'fonts/IBMPlexSans-Bold.otf')
      doc.registerFont('IBMPlexSans-Italic', 'fonts/IBMPlexSans-Italic.otf')

      // ── Inter Variable (single file, multiple weights) ──
      doc.registerFont('InterVariable', 'fonts/InterVariable.ttf')
      doc.registerFont('InterVariable-Italic', 'fonts/InterVariable-Italic.ttf')

      // ── TLWG Thai fonts (OTF from TLWG project) ──
      const tlwgOtf = 'fonts/tlwg/otf/'
      doc.registerFont('Garuda', tlwgOtf + 'Garuda.otf')
      doc.registerFont('Garuda-Bold', tlwgOtf + 'Garuda-Bold.otf')
      doc.registerFont('Garuda-Oblique', tlwgOtf + 'Garuda-Oblique.otf')
      doc.registerFont('Garuda-BoldOblique', tlwgOtf + 'Garuda-BoldOblique.otf')

      doc.registerFont('Loma', tlwgOtf + 'Loma.otf')
      doc.registerFont('Loma-Bold', tlwgOtf + 'Loma-Bold.otf')
      doc.registerFont('Loma-Oblique', tlwgOtf + 'Loma-Oblique.otf')
      doc.registerFont('Loma-BoldOblique', tlwgOtf + 'Loma-BoldOblique.otf')

      doc.registerFont('Norasi', tlwgOtf + 'Norasi.otf')
      doc.registerFont('Norasi-Bold', tlwgOtf + 'Norasi-Bold.otf')
      doc.registerFont('Norasi-Italic', tlwgOtf + 'Norasi-Italic.otf')
      doc.registerFont('Norasi-BoldItalic', tlwgOtf + 'Norasi-BoldItalic.otf')

      doc.registerFont('Kinnari', tlwgOtf + 'Kinnari.otf')
      doc.registerFont('Kinnari-Bold', tlwgOtf + 'Kinnari-Bold.otf')
      doc.registerFont('Kinnari-Italic', tlwgOtf + 'Kinnari-Italic.otf')
      doc.registerFont('Kinnari-BoldItalic', tlwgOtf + 'Kinnari-BoldItalic.otf')

      doc.registerFont('Sawasdee', tlwgOtf + 'Sawasdee.otf')
      doc.registerFont('Sawasdee-Bold', tlwgOtf + 'Sawasdee-Bold.otf')
      doc.registerFont('Sawasdee-Oblique', tlwgOtf + 'Sawasdee-Oblique.otf')
      doc.registerFont('Sawasdee-BoldOblique', tlwgOtf + 'Sawasdee-BoldOblique.otf')

      doc.registerFont('Laksaman', tlwgOtf + 'Laksaman.otf')
      doc.registerFont('Laksaman-Bold', tlwgOtf + 'Laksaman-Bold.otf')
      doc.registerFont('Laksaman-Italic', tlwgOtf + 'Laksaman-Italic.otf')
      doc.registerFont('Laksaman-BoldItalic', tlwgOtf + 'Laksaman-BoldItalic.otf')

      doc.registerFont('Purisa', tlwgOtf + 'Purisa.otf')
      doc.registerFont('Purisa-Bold', tlwgOtf + 'Purisa-Bold.otf')
      doc.registerFont('Purisa-Oblique', tlwgOtf + 'Purisa-Oblique.otf')
      doc.registerFont('Purisa-BoldOblique', tlwgOtf + 'Purisa-BoldOblique.otf')

      doc.registerFont('Umpush', tlwgOtf + 'Umpush.otf')
      doc.registerFont('Umpush-Bold', tlwgOtf + 'Umpush-Bold.otf')
      doc.registerFont('Umpush-Oblique', tlwgOtf + 'Umpush-Oblique.otf')
      doc.registerFont('Umpush-BoldOblique', tlwgOtf + 'Umpush-BoldOblique.otf')

      doc.registerFont('Waree', tlwgOtf + 'Waree.otf')
      doc.registerFont('Waree-Bold', tlwgOtf + 'Waree-Bold.otf')
      doc.registerFont('Waree-Oblique', tlwgOtf + 'Waree-Oblique.otf')
      doc.registerFont('Waree-BoldOblique', tlwgOtf + 'Waree-BoldOblique.otf')

      doc.registerFont('TlwgMono', tlwgOtf + 'TlwgMono.otf')
      doc.registerFont('TlwgMono-Bold', tlwgOtf + 'TlwgMono-Bold.otf')
      doc.registerFont('TlwgTypewriter', tlwgOtf + 'TlwgTypewriter.otf')
      doc.registerFont('TlwgTypewriter-Bold', tlwgOtf + 'TlwgTypewriter-Bold.otf')
      doc.registerFont('TlwgTypist', tlwgOtf + 'TlwgTypist.otf')
      doc.registerFont('TlwgTypist-Bold', tlwgOtf + 'TlwgTypist-Bold.otf')
      doc.registerFont('TlwgTypo', tlwgOtf + 'TlwgTypo.otf')
      doc.registerFont('TlwgTypo-Bold', tlwgOtf + 'TlwgTypo-Bold.otf')

      // ── Register custom @font-face fonts ──────────────────────────
      // Font files were already downloaded/resolved above (async context).
      // Here we just register them with PDFKit and update the font lookup.
      if (resolvedFontFaces.length > 0) {
        // Group by family
        const familyMap = new Map<string, ResolvedFontFace[]>()
        for (const rf of resolvedFontFaces) {
          const fam = rf.family
          if (!familyMap.has(fam)) familyMap.set(fam, [])
          familyMap.get(fam)!.push(rf)
        }

        for (const [family, faces] of familyMap) {
          const variants: FontVariants = { regular: 'Sarabun' }
          const familyKey = family.toLowerCase()

          for (const face of faces) {
            const isBold = face.weight === 'bold' || parseInt(face.weight, 10) >= 700
            const isItalic = face.style === 'italic' || face.style === 'oblique'

            let variantSuffix = ''
            if (isBold && isItalic) variantSuffix = '-BoldItalic'
            else if (isBold) variantSuffix = '-Bold'
            else if (isItalic) variantSuffix = '-Italic'

            const pdfkitName = `CustomFont_${familyKey.replace(/\s+/g, '')}${variantSuffix}`

            try {
              doc.registerFont(pdfkitName, face.fontPath)
            } catch { continue }

            if (isBold && isItalic) {
              variants.boldItalic = pdfkitName
            } else if (isBold) {
              variants.bold = pdfkitName
            } else if (isItalic) {
              variants.italic = pdfkitName
            } else {
              variants.regular = pdfkitName
            }
          }

          // Only register if we got at least a regular variant
          if (variants.regular !== 'Sarabun') {
            if (!variants.bold) variants.bold = variants.regular
            if (!variants.italic) variants.italic = variants.regular
            if (!variants.boldItalic) variants.boldItalic = variants.bold

            PDFRenderer.registeredFonts.set(familyKey, variants)
            const altKey = familyKey.replace(/\s+/g, '')
            if (altKey !== familyKey && !PDFRenderer.registeredFonts.has(altKey)) {
              PDFRenderer.registeredFonts.set(altKey, variants)
            }
          }
        }
      }

      let totalPages = 1

      // Track which pages already have a repeated thead drawn (per table)
      const theadRenderedPages = new Map<LayoutNode, Set<number>>()

      // Track which pages already have a repeated tfoot drawn (per table)
      const tfootRenderedPages = new Map<LayoutNode, Set<number>>()

      // Map: for each table, track which pages have a repeated thead and the
      // thead height so we can shift tbody content down to avoid overlap.
      // Key: tableNode, Value: Map<pageIndex, theadHeight>
      const theadShiftMap = new Map<LayoutNode, Map<number, number>>()

      /**
       * Compute how much vertical shift a node inside a table-tbody needs
       * on the given page due to a repeated thead header.
       */
      const getTheadShift = (node: LayoutNode, pageIndex: number): number => {
        for (const [tableNode, info] of tableTheadMap) {
          const tbody = tableNode.children.find(c => c.tagName === 'tbody')
          if (!tbody) continue
          // Check if this node is inside the tbody (direct child = tr)
          const isInsideTbody = tbody.children.includes(node) ||
            tbody.children.some(tr => isDescendant(node, tr))
          if (isInsideTbody) {
            const shifts = theadShiftMap.get(tableNode)
            if (shifts && shifts.has(pageIndex)) {
              return shifts.get(pageIndex)!
            }
          }
        }
        return 0
      }

      /** Check if a node is a descendant of an ancestor */
      const isDescendant = (node: LayoutNode, ancestor: LayoutNode): boolean => {
        if (ancestor === node) return true
        for (const child of ancestor.children) {
          if (isDescendant(node, child)) return true
        }
        return false
      }

      /**
       * Draw a layout subtree at an offset (used for repeated thead).
       * Renders the subtree with an X/Y offset from its original position.
       */
      const drawSubtreeOffset = (subtree: LayoutNode, offsetX: number, offsetY: number, targetPage: number) => {
        const renderOffsetNode = (n: LayoutNode) => {
          const nx = n.x + offsetX
          const ny = n.y + offsetY
          const nLocalY = ny - targetPage * PAGE_H

          doc.switchToPage(targetPage)

          // Background
          const bgColor = n.styles['background-color'] || n.styles['background']
          if (bgColor) {
            const parsed = ColorParser.parse(bgColor)
            if (parsed) {
              doc.save()
              doc.rect(nx, nLocalY, n.width, n.height)
                .fillOpacity(parsed.opacity).fill(parsed.color)
              doc.restore()
            }
          }

          // Borders
          const borderStr = n.styles['border']
          if (borderStr && borderStr !== 'none') {
            const parts = borderStr.trim().split(/\s+/)
            const bw = parseFloat(parts[0] ?? '1') || 1
            const bc = ColorParser.parse(parts[2] ?? parts[1] ?? '#000')
            if (bc) {
              doc.save().strokeOpacity(bc.opacity).lineWidth(bw)
                .rect(nx, nLocalY, n.width, n.height).stroke(bc.color)
                .restore()
            }
          }

          // Text
          if (n.type === 'text' && n.content) {
            const fontName = PDFRenderer.resolveFontName(n.styles)
            const fontSize = parseInt(n.styles['font-size'] || '14', 10)
            const colorStr = n.styles['color'] || '#333'
            const parsedColor = ColorParser.parse(colorStr) || { color: '#333', opacity: 1 }
            doc.font(fontName).fontSize(fontSize)
              .fillOpacity(parsedColor.opacity).fillColor(parsedColor.color)
              .text(n.content, nx, nLocalY, {
                width: n.width > 0 ? n.width + 1 : undefined,
                lineBreak: true,
              })
            doc.fillOpacity(1)
          }

          for (const child of n.children) renderOffsetNode(child)
        }
        renderOffsetNode(subtree)
      }

      const drawNode = (node: LayoutNode) => {
        // Skip position:fixed nodes — they are rendered on every page separately
        if (node.styles['position'] === 'fixed') return

        // Skip truly invisible zero-size nodes, but still recurse into children
        if (node.width === 0 && node.height === 0 && node.type !== 'text') {
          if (node.children) node.children.forEach(drawNode)
          return
        }

        // Determine which page this node's TOP sits on
        const nodePageIndex = Math.floor(node.y / PAGE_H)

        // Add pages as needed (natural page flow)
        while (totalPages <= nodePageIndex) {
          doc.addPage()
          drawWhiteBackground()
          totalPages++
        }

        // NOTE: page-break-before is intentionally NOT handled in the renderer.
        // It should be implemented in the layout phase so that Yoga can adjust
        // absolute positions of all descendant nodes.  The previous renderer-
        // side logic caused negative localY values and mystery blank pages.

        doc.switchToPage(nodePageIndex)

        // ── thead repeat: if this is a tbody row on a new page, re-render the thead ──
        // This MUST happen before computing localY so the shift is available
        if (node.tagName === 'tr') {
          for (const [tableNode, info] of tableTheadMap) {
            const tbody = tableNode.children.find(c => c.tagName === 'tbody')
            if (tbody && tbody.children.includes(node)) {
              let rendered = theadRenderedPages.get(tableNode)
              if (!rendered) {
                rendered = new Set<number>()
                theadRenderedPages.set(tableNode, rendered)
              }
              // Use actual thead row positions (not container .y which may
              // be stale after page-break shifts) to decide if a repeat is needed.
              const theadAlreadyOnThisPage = info.theadContentPages.has(nodePageIndex)
              if (!theadAlreadyOnThisPage && !rendered.has(nodePageIndex)) {
                // Check if there are any meaningful data rows on this page
                // beyond just the current row. If this is the last tbody row
                // and only marginally overflows, don't render thead on an
                // otherwise empty page.
                const rowIdxInTbody = tbody.children.indexOf(node)
                const remainingRows = tbody.children.slice(rowIdxInTbody + 1)
                const hasMoreRowsOnThisPage = remainingRows.some(r => Math.floor(r.y / PAGE_H) === nodePageIndex)
                const isLastRow = rowIdxInTbody === tbody.children.length - 1

                // Skip thead if this is the last row and no sibling rows share this page
                if (isLastRow && !hasMoreRowsOnThisPage) {
                  break
                }

                rendered.add(nodePageIndex)
                // Draw thead at the top margin of this page
                const theadTargetY = nodePageIndex * PAGE_H + pageMargin
                const offsetX = info.tableX - info.theadNode.x
                const offsetY = theadTargetY - info.theadNode.y
                drawSubtreeOffset(info.theadNode, offsetX, offsetY, nodePageIndex)

                // Compute shift: push content below the repeated thead
                // The first TR's original localY might be near 0 (just overflowed).
                // We need all content to start at pageMargin + theadHeight.
                const localYWithoutShift = node.y - nodePageIndex * PAGE_H
                const correctShift = Math.max(0, pageMargin + info.theadHeight - localYWithoutShift)

                let shifts = theadShiftMap.get(tableNode)
                if (!shifts) {
                  shifts = new Map<number, number>()
                  theadShiftMap.set(tableNode, shifts)
                }
                shifts.set(nodePageIndex, correctShift)
              }
              break
            }
          }
        }

        // ── tfoot repeat: draw tfoot at the bottom of each page where tbody continues ──
        if (node.tagName === 'tr') {
          for (const [tableNode, tfInfo] of tableTfootMap) {
            const tbody = tableNode.children.find(c => c.tagName === 'tbody')
            if (tbody && tbody.children.includes(node)) {
              const rowIdxInTbody = tbody.children.indexOf(node)
              const nextRow = tbody.children[rowIdxInTbody + 1]
              // Render tfoot when the next row is on a different page (table continues)
              // or when this is a row on a page that a following row leaves
              if (nextRow) {
                const nextRowPage = Math.floor(nextRow.y / PAGE_H)
                if (nextRowPage !== nodePageIndex) {
                  let tfRendered = tfootRenderedPages.get(tableNode)
                  if (!tfRendered) {
                    tfRendered = new Set<number>()
                    tfootRenderedPages.set(tableNode, tfRendered)
                  }
                  const tfootOrigPage = Math.floor(tfInfo.tfootNode.y / PAGE_H)
                  if (nodePageIndex !== tfootOrigPage && !tfRendered.has(nodePageIndex)) {
                    tfRendered.add(nodePageIndex)
                    // Draw tfoot at the bottom of the current page
                    const tfootTargetY = (nodePageIndex + 1) * PAGE_H - pageMargin - tfInfo.tfootHeight
                    const offsetX = tfInfo.tableX - tfInfo.tfootNode.x
                    const offsetY = tfootTargetY - tfInfo.tfootNode.y
                    drawSubtreeOffset(tfInfo.tfootNode, offsetX, offsetY, nodePageIndex)
                  }
                }
              }
              break
            }
          }
        }

        const theadShift = getTheadShift(node, nodePageIndex)
        const localY = node.y - nodePageIndex * PAGE_H + theadShift

        // ── Overflow: hidden clipping (applied BEFORE rotation) ──
        // Clip elements with explicit overflow:hidden in
        // the unrotated coordinate space so the clip rect is correct.
        // Table cells rely on proper Yoga layout + text wrapping instead
        // of hard clipping, so content can display fully.
        const hasOverflowHidden = node.styles['overflow'] === 'hidden'
        if (hasOverflowHidden) {
          doc.save()
          doc.rect(node.x, localY, node.width, node.height).clip()
        }

        // ── transform: rotate() support ───────────────────────
        // Parse CSS transform for rotation and apply PDFKit graphics state rotation.
        // The rotation is around the center of the element's bounding box.
        const transformStr = node.styles['transform']
        let rotationDeg = 0
        if (transformStr) {
          const rotateMatch = transformStr.match(/rotate\(\s*(-?[\d.]+)\s*deg\s*\)/)
          if (rotateMatch) {
            rotationDeg = parseFloat(rotateMatch[1]!)
          }
        }
        const hasRotation = rotationDeg !== 0
        if (hasRotation) {
          doc.save()
          // Rotate around the center of the element
          const cx = node.x + node.width / 2
          const cy = localY + node.height / 2
          doc.rotate(rotationDeg, { origin: [cx, cy] })
        }

        // Register named destination for elements with id (internal link targets)
        if (node.attrs && node.attrs['id']) {
          doc.addNamedDestination(node.attrs['id'], 'XYZ', node.x, localY, null)
        }

        // Draw Background — use save/restore to isolate fill state
        const bgColorStr = node.styles['background-color'] || node.styles['background']
        if (bgColorStr) {
          const parsedBg = ColorParser.parse(bgColorStr)
          if (parsedBg) {
            const bgRadius = PDFRenderer.parseBorderRadius(node.styles['border-radius'], node.width, node.height)
            doc.save()
            if (bgRadius > 0) {
              doc.roundedRect(node.x, localY, node.width, node.height, bgRadius)
            } else {
              doc.rect(node.x, localY, node.width, node.height)
            }
            doc.fillOpacity(parsedBg.opacity)
              .fill(parsedBg.color)
            doc.restore()
          }
        }

        // Draw all borders (supports border shorthand + individual sides)
        // Skip text nodes — they inherit styles from their parent element
        // but should never draw their own borders.
        if (node.type !== 'text') {
          PDFRenderer.drawBorders(doc, node, localY)
        }

        if (node.type === 'text' && node.content) {
          const fontName = PDFRenderer.resolveFontName(node.styles)

          const fontSize = parseInt(node.styles['font-size'] || '14', 10)
          const colorStr = node.styles['color'] || '#333'
          const parsedColor = ColorParser.parse(colorStr) || { color: '#333', opacity: 1 }
          const textAlign = (node.styles['text-align'] || 'left') as 'left' | 'center' | 'right' | 'justify'

          // ── Line-height → PDFKit lineGap ──────────────────────
          const lineHeightRaw = node.styles['line-height']
          let lineGap = 0
          if (lineHeightRaw) {
            const lhVal = parseFloat(lineHeightRaw)
            if (!isNaN(lhVal)) {
              const multiplier = lineHeightRaw.endsWith('px') ? lhVal / fontSize : lhVal
              lineGap = Math.max(0, fontSize * (multiplier - PDFRenderer.NATURAL_LH))
            }
          }

          // Width buffer: +2pt to prevent last-character truncation from
          // floating-point rounding differences between fontkit and PDFKit.
          const renderWidth = node.width > 0 ? node.width + 2 : undefined

          // Pre-wrap text at Thai word boundaries using actual '\n' characters.
          // This replaces the old U+200B approach which caused square boxes
          // because the font lacked a glyph for the zero-width space.
          const fontPath = PDFRenderer.resolveFontPath(node.styles)
          const isPreformatted = node.styles['white-space'] === 'pre'
          let processedContent: string
          if (isPreformatted) {
            // Preserve whitespace exactly — no word-wrapping, no trimming
            processedContent = node.content
          } else {
            const wrapWidth = node.width > 0 ? node.width : 495
            processedContent = textMeasurer.wrapText(node.content, fontSize, wrapWidth, fontPath)
            // Trim leading whitespace from each line to prevent jagged left edges
            processedContent = processedContent.split('\n').map(l => l.trimStart()).join('\n')
          }

          // ── Emoji-aware rendering ──────────────────────────────
          const emojiRuns = emojiRunMap.get(node) || [{ type: 'text' as const, text: processedContent }]
          let cursorX = node.x
          let cursorY = localY
          const lineH = fontSize * Math.max(PDFRenderer.NATURAL_LH, 1.0) + lineGap

          const hasEmojiContent = emojiRuns.some(r => r.type === 'emoji')

          // Wrap text rendering in save/restore to isolate fill color/opacity
          doc.save()

          // ── Preformatted text — render line by line ──────────────
          if (isPreformatted) {
            doc.fontSize(fontSize)
              .fillOpacity(parsedColor.opacity)
              .font(fontName)

            // If we have color segments (syntax highlighted code), render per-token
            if (node.colorSegments && node.colorSegments.length > 0) {
              // Merge segments into lines preserving color
              const segLines = PDFRenderer.splitSegmentsIntoLines(node.colorSegments)
              let cy = localY
              for (const lineSegs of segLines) {
                let cx = node.x
                for (const seg of lineSegs) {
                  if (!seg.text) continue
                  const segColor = seg.color ? (ColorParser.parse(seg.color) || parsedColor) : parsedColor
                  doc.fillOpacity(segColor.opacity).fillColor(segColor.color).font(fontName)
                  doc.text(seg.text, cx, cy, { lineBreak: false, continued: false })
                  cx += textMeasurer.measureWidth(seg.text, fontSize, fontPath)
                }
                cy += lineH
              }
            } else {
              doc.fillColor(parsedColor.color)
              const lines = processedContent.split('\n')
              let cy = localY
              for (const line of lines) {
                if (line) {
                  doc.text(line, node.x, cy, { lineBreak: false })
                }
                cy += lineH
              }
            }
          } else if (!hasEmojiContent) {
            const renderHeight = node.height > 0 ? node.height + fontSize * 0.5 : undefined

            // Check if text needs glyph fallback (e.g., ✓ not in Sarabun)
            const glyphRuns = PDFRenderer.splitByGlyphAvailability(processedContent, fontPath, fontName)
            const needsFallback = glyphRuns.length > 1 || (glyphRuns.length === 1 && glyphRuns[0]?.fontName !== fontName)

            if (!needsFallback) {
              if (textAlign === 'justify' && node.width > 0) {
                // Manual justification — PDFKit can't justify pre-wrapped text
                doc.fontSize(fontSize)
                  .fillOpacity(parsedColor.opacity)
                  .fillColor(parsedColor.color)
                  .font(fontName)
                PDFRenderer.renderJustifiedText(
                  doc, processedContent, node.x, localY,
                  node.width, fontSize, lineGap, fontName,
                  fontPath, fontName,
                )
              } else {
                // All glyphs available in primary font — single text() call
                doc.fontSize(fontSize)
                  .fillOpacity(parsedColor.opacity)
                  .fillColor(parsedColor.color)
                  .font(fontName)
                  .text(processedContent, node.x, localY, {
                    width: renderWidth,
                    height: renderHeight,
                    align: textAlign,
                    lineBreak: true,
                    lineGap,
                  })
              }
            } else {
              if (textAlign === 'justify' && node.width > 0) {
                // Manual justification with glyph fallback
                doc.fontSize(fontSize)
                  .fillOpacity(parsedColor.opacity)
                  .fillColor(parsedColor.color)
                PDFRenderer.renderJustifiedText(
                  doc, processedContent, node.x, localY,
                  node.width, fontSize, lineGap, fontName,
                  fontPath, fontName,
                )
              } else {
                // Mixed fonts — render runs inline (simple left-to-right)
                doc.fontSize(fontSize)
                  .fillOpacity(parsedColor.opacity)
                  .fillColor(parsedColor.color)
                let cx = node.x
                let cy = localY
                for (const run of glyphRuns) {
                  doc.font(run.fontName)
                  doc.text(run.text, cx, cy, { lineBreak: false })
                  cx += doc.widthOfString(run.text)
                  // Simple line wrap
                  if (renderWidth && cx - node.x > (renderWidth - 1)) {
                    cx = node.x
                    cy += lineH
                  }
                }
              }
            }
          } else {
            doc.fontSize(fontSize)
              .fillOpacity(parsedColor.opacity)
              .fillColor(parsedColor.color)

            const emojiSize = fontSize
            const emojiY = cursorY + (lineH - emojiSize) / 2

            for (const run of emojiRuns) {
              if (run.type === 'emoji' && run.pngPath) {
                try {
                  doc.image(run.pngPath, cursorX, emojiY, {
                    width: emojiSize,
                    height: emojiSize,
                  })
                } catch (e) {
                  doc.font('NotoEmoji')
                  doc.text(run.text, cursorX, cursorY, { lineBreak: false })
                }
                cursorX += emojiSize
              } else {
                doc.font(fontName)
                const runText = run.text
                doc.text(runText, cursorX, cursorY, {
                  lineBreak: false,
                })
                cursorX += doc.widthOfString(runText)
              }

              if (renderWidth && cursorX - node.x > (renderWidth - 1)) {
                cursorX = node.x
                cursorY += lineH
              }
            }
          }

          doc.restore()
        }

        if (node.tagName === 'svg' && node.content) {
          // Save/restore graphics state around SVG rendering to prevent
          // SVGtoPDF from corrupting fill/stroke/opacity for subsequent nodes.
          doc.save()
          SVGtoPDF(doc, node.content, node.x, localY, {
            width: node.width,
            height: node.height,
            preserveAspectRatio: 'xMidYMid meet'
          })
          doc.restore()
        }

        if (node.tagName === 'img' && node.attrs && node.attrs['src']) {
          try {
            const src = node.attrs['src']
            // For now, assume src is a local file path or base64
            // In a real app, you'd need to fetch remote images
            if (fs.existsSync(src)) {
              doc.image(src, node.x, localY, {
                width: node.width,
                height: node.height
              })
            } else {
              console.warn(`Image not found: ${src}`)
            }
          } catch (e) {
            console.error(`Failed to render image:`, e)
          }
        }

        if (node.tagName === 'li') {
          const listStyleType = node.styles['list-style-type'] || 'disc'
          const fontSize = parseInt(node.styles['font-size'] || '16', 10)
          const colorStr = node.styles['color'] || 'black'
          const parsedColor = ColorParser.parse(colorStr) || { color: 'black', opacity: 1 }

          doc.save()
          doc.font('Sarabun')
            .fontSize(fontSize)
            .fillOpacity(parsedColor.opacity)
            .fillColor(parsedColor.color)

          if (listStyleType === 'decimal' && node.listIndex !== undefined) {
            doc.text(`${node.listIndex}.`, node.x - 20, localY, { lineBreak: false })
          } else {
            doc.circle(node.x - 10, localY + (fontSize / 2), fontSize / 4)
              .fill(parsedColor.color)
          }
          doc.restore()
        }

        // ── <a> link annotations ──────────────────────────────
        if (node.tagName === 'a' && node.attrs) {
          const href = node.attrs['href']
          if (href) {
            if (href.startsWith('#')) {
              // Internal link — register a goTo destination
              const targetId = href.slice(1)
              const target = idMap.get(targetId)
              if (target) {
                doc.goTo(node.x, localY, node.width, node.height, targetId)
              }
            } else {
              // External link
              doc.link(node.x, localY, node.width, node.height, href)
            }
          }
        }

        // ── Overflow: hidden clipping ────────────────────────
        // (Moved before rotation — see above)

        if (node.children) {
          for (const child of node.children) {
            drawNode(child)
          }
        }

        // Close transform rotation (must be before clip restore)
        if (hasRotation) {
          doc.restore()
        }

        // Close overflow clipping
        if (hasOverflowHidden) {
          doc.restore()
        }
      }

      drawNode(layout)

      // ── Render position:fixed nodes on every page ──────────────
      if (fixedNodes.length > 0) {
        const range0 = doc.bufferedPageRange()
        for (const fixedNode of fixedNodes) {
          // The node's layout Y is on its original page.
          // Extract the local position relative to that page.
          const origPage = Math.floor(fixedNode.y / PAGE_H)
          const localFixedY = fixedNode.y - origPage * PAGE_H
          for (let p = range0.start; p < range0.start + range0.count; p++) {
            doc.switchToPage(p)
            // Draw the fixed subtree at the same local position on each page
            const offsetX = 0
            const offsetY = (p * PAGE_H + localFixedY) - fixedNode.y
            drawSubtreeOffset(fixedNode, offsetX, offsetY, p)
          }
        }
      }

      // Draw Headers and Footers
      const range = doc.bufferedPageRange()
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i)

        // Find applicable page rules
        let activeRule: PageRule | undefined
        for (const rule of pageRules) {
          if (rule.selector === '' || (rule.selector === ':first' && i === 0)) {
            activeRule = rule
          }
        }

        if (activeRule && activeRule.marginBoxes) {
          const pageWidth = doc.page.width
          const pageHeight = doc.page.height
          const margin = pageMargin // Dynamic @page margin

          // Clear header/footer zones with white background so content
          // that bleeds into these areas is hidden before we draw headers/footers.
          const hasTopBox = Object.keys(activeRule.marginBoxes).some(k => k.includes('top'))
          const hasBottomBox = Object.keys(activeRule.marginBoxes).some(k => k.includes('bottom'))
          if (hasTopBox) {
            doc.save()
            doc.addContent('1 1 1 rg')
            doc.rect(0, 0, pageWidth, margin)
            doc.addContent('f')
            doc.restore()
          }
          if (hasBottomBox) {
            doc.save()
            doc.addContent('1 1 1 rg')
            doc.rect(0, pageHeight - margin, pageWidth, margin)
            doc.addContent('f')
            doc.restore()
          }

          for (const [boxName, styles] of Object.entries(activeRule.marginBoxes)) {
            let contentRaw = styles['content'] || ''

            // Parse content string (e.g., "Page " counter(page) " of " counter(pages))
            let content = ''
            const parts = contentRaw.split(/(counter\([^)]+\)|"[^"]*"|'[^']*')/g).filter(Boolean)

            for (let part of parts) {
              part = part.trim()
              if (part.startsWith('"') || part.startsWith("'")) {
                content += part.slice(1, -1)
              } else if (part === 'counter(page)') {
                content += (i + 1).toString()
              } else if (part === 'counter(pages)') {
                content += range.count.toString()
              }
            }

            if (content) {
              const fontSize = parseInt(styles['font-size'] || '10', 10)
              const colorStr = styles['color'] || '#000'
              const parsedColor = ColorParser.parse(colorStr) || { color: '#000', opacity: 1 }

              doc.font('Sarabun')
                .fontSize(fontSize)
                .fillOpacity(parsedColor.opacity)
                .fillColor(parsedColor.color)

              let x = margin
              let y = margin / 2
              let align: 'left' | 'center' | 'right' = 'left'

              if (boxName.includes('top')) y = margin / 2
              if (boxName.includes('bottom')) y = pageHeight - (margin / 2) - fontSize

              if (boxName.includes('left')) {
                x = margin
                align = 'left'
              } else if (boxName.includes('center')) {
                x = margin
                align = 'center'
              } else if (boxName.includes('right')) {
                x = margin
                align = 'right'
              }

              doc.text(content, x, y, { width: pageWidth - (margin * 2), align, lineBreak: false })
            }
          }
        }
      }

      // Flush pages
      doc.flushPages()

      doc.end()

      stream.on('finish', () => resolve())
      stream.on('error', reject)
    })
  }
}
