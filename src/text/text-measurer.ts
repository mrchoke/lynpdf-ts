import * as fontkit from 'fontkit';

export class TextMeasurer {
  private defaultFont: fontkit.Font;
  private defaultFontPath: string;

  /** Lazily-loaded font cache: fontPath → fontkit.Font */
  private fontCache = new Map<string, fontkit.Font>();

  /** Cache: fontPath+fontSize → (char → width) */
  private charWidthCache = new Map<string, Map<string, number>>();

  /** Intl.Segmenter for Thai/mixed word segmentation */
  private static segmenter = new Intl.Segmenter('th-TH', { granularity: 'word' });

  /** (ascent − descent + lineGap) / unitsPerEm — matches PDFKit's natural line height */
  readonly naturalLineHeightMultiplier: number;

  constructor(fontPath: string) {
    this.defaultFontPath = fontPath;
    this.defaultFont = fontkit.openSync(fontPath);
    this.fontCache.set(fontPath, this.defaultFont);
    this.naturalLineHeightMultiplier =
      (this.defaultFont.ascent - this.defaultFont.descent + (this.defaultFont.lineGap ?? 0)) / this.defaultFont.unitsPerEm;
  }

  /** Get a font by path (with lazy loading and caching). */
  private getFont(fontPath?: string): fontkit.Font {
    if (!fontPath || fontPath === this.defaultFontPath) return this.defaultFont;
    let font = this.fontCache.get(fontPath);
    if (!font) {
      try {
        font = fontkit.openSync(fontPath);
      } catch {
        font = this.defaultFont;
      }
      this.fontCache.set(fontPath, font);
    }
    return font;
  }

  // ─── Width measurement ───────────────────────────────────────────

  /** Full-string width via fontkit layout (accurate for kerning / ligatures). */
  measureWidth(text: string, fontSize: number, fontPath?: string): number {
    if (!text) return 0;
    const font = this.getFont(fontPath);
    const run = font.layout(text);
    return (run.advanceWidth / font.unitsPerEm) * fontSize;
  }

  /** Single-character width with per-fontSize + per-font cache. */
  private getCharWidth(char: string, fontSize: number, fontPath?: string): number {
    const cacheKey = `${fontPath || this.defaultFontPath}:${fontSize}`;
    let sizeMap = this.charWidthCache.get(cacheKey);
    if (!sizeMap) {
      sizeMap = new Map();
      this.charWidthCache.set(cacheKey, sizeMap);
    }
    let w = sizeMap.get(char);
    if (w === undefined) {
      w = this.measureWidth(char, fontSize, fontPath);
      sizeMap.set(char, w);
    }
    return w;
  }

  // ─── Height / line-height ────────────────────────────────────────

  /**
   * One-line height using the font's actual metrics, optionally scaled by a
   * CSS line-height multiplier.  The returned value matches what PDFKit would
   * use *before* adding `lineGap`.
   *
   * When `lineHeightMultiplier` ≤ 0 or omitted the natural font metric is
   * used (≈ 1.3 for Sarabun).
   */
  measureHeight(fontSize: number, lineHeightMultiplier: number = 0): number {
    const m = lineHeightMultiplier > 0
      ? Math.max(this.naturalLineHeightMultiplier, lineHeightMultiplier)
      : this.naturalLineHeightMultiplier;
    return fontSize * m;
  }

  /**
   * Calculate the PDFKit `lineGap` option value that, together with the
   * font's natural line height, results in the desired total per-line height.
   */
  calcLineGap(fontSize: number, lineHeightMultiplier: number): number {
    const desired = fontSize * lineHeightMultiplier;
    const natural = fontSize * this.naturalLineHeightMultiplier;
    return Math.max(0, desired - natural);
  }

  // ─── Line counting ───────────────────────────────────────────────

  /**
   * Count the number of visual lines needed to render `text` within
   * `maxWidth`, using Intl.Segmenter for proper Thai word boundaries.
   *
   * • Latin text: wrap at word boundaries.
   * • Thai text: wrap at word boundaries via Intl.Segmenter.
   * • Any word wider than the line: wrap at character boundaries.
   */
  countLines(text: string, fontSize: number, maxWidth: number, fontPath?: string): number {
    if (!text || maxWidth <= 0) return 1;

    // Fast path — entire text fits on one line
    const totalWidth = this.measureWidth(text, fontSize, fontPath);
    if (totalWidth <= maxWidth + 0.5) return 1;

    // Use Intl.Segmenter for word-aware segmentation (handles Thai, English, mixed)
    const segments = Array.from(TextMeasurer.segmenter.segment(text));

    let lines = 1;
    let lineWidth = 0;

    for (const seg of segments) {
      const s = seg.segment;

      // ── Newline ──────────────────────────────────────────────
      if (s === '\n') {
        lines++;
        lineWidth = 0;
        continue;
      }

      // ── Space/non-word segment ───────────────────────────────
      if (!seg.isWordLike) {
        if (/^\s+$/.test(s)) {
          const sw = this.measureWidth(s, fontSize, fontPath);
          if (lineWidth + sw > maxWidth && lineWidth > 0) {
            lines++;
            lineWidth = 0;
          } else {
            lineWidth += sw;
          }
        }
        // Non-space, non-word segments (punctuation within words, etc.)
        // measure and add to current line
        else {
          const pw = this.measureWidth(s, fontSize, fontPath);
          if (lineWidth > 0 && lineWidth + pw > maxWidth) {
            lines++;
            lineWidth = pw;
          } else {
            lineWidth += pw;
          }
        }
        continue;
      }

      // ── Word segment ─────────────────────────────────────────
      const wordWidth = this.measureWidth(s, fontSize, fontPath);

      if (wordWidth <= maxWidth) {
        // Word fits on one line
        if (lineWidth > 0 && lineWidth + wordWidth > maxWidth) {
          lines++;
          lineWidth = wordWidth;
        } else {
          lineWidth += wordWidth;
        }
      } else {
        // Word wider than the line → character-level wrapping
        if (lineWidth > 0) {
          lines++;
          lineWidth = 0;
        }
        for (const ch of s) {
          const cw = this.getCharWidth(ch, fontSize, fontPath);
          if (cw === 0) continue; // combining mark (e.g. Thai vowel above)
          if (lineWidth + cw > maxWidth && lineWidth > 0) {
            lines++;
            lineWidth = cw;
          } else {
            lineWidth += cw;
          }
        }
      }
    }

    return Math.max(1, lines);
  }

  /**
   * Pre-wrap text with explicit newlines at Thai (and Latin) word boundaries.
   * Uses the same Intl.Segmenter logic as countLines so that the number of
   * resulting lines matches what Yoga measured.  Because the breaks are real
   * '\n' characters, PDFKit never sees invisible U+200B glyphs (which would
   * render as squares when the font lacks that glyph).
   */
  wrapText(text: string, fontSize: number, maxWidth: number, fontPath?: string): string {
    if (!text || maxWidth <= 0) return text;

    // Fast path — entire text fits on one line
    const totalWidth = this.measureWidth(text, fontSize, fontPath);
    if (totalWidth <= maxWidth + 0.5) return text;

    const segments = Array.from(TextMeasurer.segmenter.segment(text));
    let result = '';
    let lineWidth = 0;

    for (const seg of segments) {
      const s = seg.segment;

      // ── Explicit newline ──────────────────────────────────
      if (s === '\n') {
        result += '\n';
        lineWidth = 0;
        continue;
      }

      // ── Whitespace ────────────────────────────────────────
      if (!seg.isWordLike) {
        if (/^\s+$/.test(s)) {
          const sw = this.measureWidth(s, fontSize, fontPath);
          if (lineWidth + sw > maxWidth && lineWidth > 0) {
            result += '\n';
            lineWidth = 0;
          } else {
            result += s;
            lineWidth += sw;
          }
        } else {
          // Punctuation / non-word segment
          const pw = this.measureWidth(s, fontSize, fontPath);
          if (lineWidth > 0 && lineWidth + pw > maxWidth) {
            result += '\n';
            lineWidth = pw;
          } else {
            lineWidth += pw;
          }
          result += s;
        }
        continue;
      }

      // ── Word segment ──────────────────────────────────────
      const wordWidth = this.measureWidth(s, fontSize, fontPath);

      if (wordWidth <= maxWidth) {
        if (lineWidth > 0 && lineWidth + wordWidth > maxWidth) {
          result += '\n';
          lineWidth = wordWidth;
        } else {
          lineWidth += wordWidth;
        }
        result += s;
      } else {
        // Word wider than line → character-level wrapping
        if (lineWidth > 0) {
          result += '\n';
          lineWidth = 0;
        }
        for (const ch of s) {
          const cw = this.getCharWidth(ch, fontSize, fontPath);
          if (cw === 0) {
            // Combining mark — keep with base character
            result += ch;
            continue;
          }
          if (lineWidth + cw > maxWidth && lineWidth > 0) {
            result += '\n';
            lineWidth = cw;
          } else {
            lineWidth += cw;
          }
          result += ch;
        }
      }
    }

    return result;
  }
}
