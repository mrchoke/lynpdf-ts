import type * as cssTree from 'css-tree'
import type { Node } from 'yoga-layout'
import Yoga from 'yoga-layout'
import { NAMED_PAGE_SIZES, PAGE_H, PAGE_MARGIN, PAGE_W } from '../constants'
import { TextMeasurer } from '../text/text-measurer'
import { anchorPageBreaks, applyMarginZoneCleanup, applyOrphansWidows, applyPageFlow, applyTheadRepeatShift, compactSiblingGaps, compactTableRowGaps, fixTableRowPositions } from './page-break'
import type { FontFaceRule, PageRule } from './style-resolver'
import { StyleResolver } from './style-resolver'
import { YogaMapper } from './yoga-mapper'

/** A styled text segment for preformatted code or inline text flow. */
export interface ColorSegment {
  text: string
  color?: string      // inline CSS color, e.g. '#d73a49'
  fontWeight?: string  // e.g. 'bold'
  fontStyle?: string   // e.g. 'italic'
  fontFamily?: string  // e.g. "'IBM Plex Mono', monospace"
}

export interface LayoutNode {
  type: 'document' | 'block' | 'text'
  tagName?: string
  content?: string
  attrs?: Record<string, string>
  x: number
  y: number
  width: number
  height: number
  styles: Record<string, string>
  children: LayoutNode[]
  listIndex?: number
  /** Per-token color info for preformatted code blocks (syntax highlighting). */
  colorSegments?: ColorSegment[]
}

export interface LayoutResult {
  rootNode: LayoutNode
  pageRules: PageRule[]
  fontFaceRules: FontFaceRule[]
  /** Resolved page margin in points (from @page { margin } or default 50pt) */
  pageMargin: number
  /** Resolved page width in points (from @page { size } or default A4 595.28pt) */
  pageWidth: number
  /** Resolved page height in points (from @page { size } or default A4 841.89pt) */
  pageHeight: number
}

export class LayoutEngine {
  /**
   * Parse a CSS length value (e.g., '0.5in', '36pt', '1cm', '12mm', '16px') to points.
   */
  static parseCssLength (raw: string): number {
    const trimmed = raw.trim()
    const val = parseFloat(trimmed)
    if (isNaN(val)) return PAGE_MARGIN
    if (trimmed.endsWith('in')) return val * 72
    if (trimmed.endsWith('cm')) return val * 28.3465
    if (trimmed.endsWith('mm')) return val * 2.83465
    if (trimmed.endsWith('pt')) return val
    if (trimmed.endsWith('px')) return val * 0.75
    // bare number → treat as points
    return val
  }

  /**
   * Parse a CSS @page `size` value to [width, height] in points.
   * Handles:
   *   - Named sizes: "A4", "letter", "legal", etc.
   *   - Named + orientation: "A4 landscape", "A4 portrait"
   *   - Explicit dimensions: "841.89pt 595.28pt", "29.7cm 21cm"
   */
  static parsePageSize (raw: string): [number, number] {
    const value = raw.trim().toLowerCase()

    // Split into tokens
    const tokens = value.split(/\s+/)

    // Check if orientation keyword is present
    const isLandscape = tokens.includes('landscape')
    const isPortrait = tokens.includes('portrait')

    // Filter out orientation keywords to get size tokens
    const sizeTokens = tokens.filter(t => t !== 'landscape' && t !== 'portrait')

    let width = PAGE_W
    let height = PAGE_H

    if (sizeTokens.length === 1) {
      // Named size (e.g. "a4")
      const named = NAMED_PAGE_SIZES[sizeTokens[0]!]
      if (named) {
        [width, height] = named
      }
    } else if (sizeTokens.length >= 2) {
      // Could be explicit dimensions (e.g. "841.89pt 595.28pt") or two-word name
      const w = parseFloat(sizeTokens[0]!)
      const h = parseFloat(sizeTokens[1]!)
      if (!isNaN(w) && !isNaN(h)) {
        // Determine units from first token
        const unit0 = sizeTokens[0]!.replace(/[\d.+-]/g, '')
        const unit1 = sizeTokens[1]!.replace(/[\d.+-]/g, '')
        const toPoints = (v: number, unit: string) => {
          if (unit === 'in') return v * 72
          if (unit === 'cm') return v * 28.3465
          if (unit === 'mm') return v * 2.83465
          if (unit === 'px') return v * 0.75
          return v // pt or bare number
        }
        width = toPoints(w, unit0)
        height = toPoints(h, unit1)
      }
    }

    // Apply orientation override
    if (isLandscape && width < height) {
      // Swap to landscape
      [width, height] = [height, width]
    } else if (isPortrait && width > height) {
      // Swap to portrait
      [width, height] = [height, width]
    }

    return [width, height]
  }

  /**
   * Resolve the font file path from CSS styles (font-weight, font-style).
   * Matches the rendering font so layout measurement is accurate.
   */
  private static resolveFontPath (styles: Record<string, string>): string {
    const isBold = styles['font-weight'] === 'bold' || parseInt(styles['font-weight'] || '400', 10) >= 700
    const isItalic = styles['font-style'] === 'italic'
    if (isBold && isItalic) return 'fonts/Sarabun-BoldItalic.ttf'
    if (isBold) return 'fonts/Sarabun-Bold.ttf'
    if (isItalic) return 'fonts/Sarabun-Italic.ttf'
    return 'fonts/Sarabun-Regular.ttf'
  }

  /**
   * Calculates the layout (Box Model) based on the DOM and CSS AST using Yoga Layout.
   * @param dom The parsed HTML DOM.
   * @param styles The parsed CSS AST.
   * @returns A layout tree with calculated positions and dimensions.
   */
  static calculate (dom: any, styles: cssTree.CssNode): LayoutResult {
    const styleResolver = new StyleResolver(styles)
    const textMeasurer = new TextMeasurer('fonts/Sarabun-Regular.ttf')

    // ── Resolve @page margin & size ──────────────────────────────────
    // Look for @page { margin, size } in the CSS and convert to points.
    // Falls back to defaults (A4 portrait, 50pt margin) if not specified.
    let pageMargin = PAGE_MARGIN // default from constants
    let pageWidth = PAGE_W      // default A4 portrait
    let pageHeight = PAGE_H
    const pageRules = styleResolver.getPageRules()
    for (const rule of pageRules) {
      if (rule.declarations['margin']) {
        pageMargin = LayoutEngine.parseCssLength(rule.declarations['margin'])
      }
      if (rule.declarations['size']) {
        const [w, h] = LayoutEngine.parsePageSize(rule.declarations['size'])
        pageWidth = w
        pageHeight = h
      }
    }

    const rootYogaNode = Yoga.Node.create()
    rootYogaNode.setWidth(pageWidth)
    // NOTE: No setHeight — let the document grow to whatever height content needs.
    // The renderer maps Y coordinates to PDF pages by dividing by pageHeight.
    rootYogaNode.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN)
    rootYogaNode.setPadding(Yoga.EDGE_ALL, pageMargin)

    interface CustomNode {
      yogaNode: Node
      data: { type: string, tagName?: string, content?: string, attrs?: Record<string, string>, styles: Record<string, string>, listIndex?: number, colorSegments?: ColorSegment[] }
      children: CustomNode[]
    }

    const customRoot: CustomNode = {
      yogaNode: rootYogaNode,
      data: { type: 'document', styles: {} },
      children: []
    }

    /** Tracks column width configuration for a table, populated from
     *  the first row and applied to all subsequent rows. */
    interface TableColumnInfo {
      /** Resolved CSS width for each column (undefined = auto). */
      columnWidths: (string | undefined)[]
      /** Whether the first row's cells have been fully processed. */
      firstRowDone: boolean
      /** Tracks cell index within the current row. */
      cellIndex: number
    }

    // ── Inline flattening helpers ──────────────────────────────────
    // Tags whose children can be flattened into a single text node.
    const FLATTENABLE_INLINE = new Set(['strong', 'b', 'em', 'i', 'code', 'span', 'br', 's', 'del', 'sub', 'sup', 'mark', 'small', 'u', 'label', 'abbr', 'time'])
    const STYLED_INLINE = new Set(['strong', 'b', 'em', 'i', 'code', 'span', 's', 'del', 'sub', 'sup', 'mark', 'small', 'u'])

    /** Check recursively that a node's children are all inline (flattenable). */
    const canFlattenInline = (n: any): boolean => {
      if (!n.childNodes) return true
      return n.childNodes.every((c: any) => {
        if (c.nodeName === '#text' || c.nodeName === '#comment') return true
        if (FLATTENABLE_INLINE.has(c.nodeName)) return canFlattenInline(c)
        return false
      })
    }

    /** Check if a node has at least one styled inline child (not just text). */
    const hasStyledInlineChild = (n: any): boolean => {
      if (!n.childNodes) return false
      return n.childNodes.some((c: any) => STYLED_INLINE.has(c.nodeName))
    }

    /** Recursively extract styled text segments from inline DOM nodes. */
    const extractInlineSegments = (
      n: any,
      inherited: Record<string, string>,
      chain: Array<{ tagName: string, classes: string[], id?: string }>
    ): ColorSegment[] => {
      if (n.nodeName === '#text') {
        let text = n.value || ''
        text = text.replace(/[\n\t\r]+/g, ' ')
        if (!text) return []
        return [{
          text,
          color: inherited['color'],
          fontWeight: inherited['font-weight'],
          fontStyle: inherited['font-style'],
          fontFamily: inherited['font-family'],
        }]
      }
      if (n.nodeName === '#comment') return []
      if (n.nodeName === 'br') return [{ text: '\n' }]

      const tn = n.nodeName as string
      if (!FLATTENABLE_INLINE.has(tn)) return []

      const attrs = n.attrs || []
      const clsAttr = attrs.find((a: any) => a.name === 'class')
      const idAt = attrs.find((a: any) => a.name === 'id')
      const cls = clsAttr ? clsAttr.value.split(' ') : []
      const nid = idAt ? idAt.value : undefined

      const nStyles = styleResolver.resolve(tn, cls, nid, chain)
      const childChain = [...chain, { tagName: tn, classes: cls, id: nid }]

      const stAttr = attrs.find((a: any) => a.name === 'style')
      const inSt: Record<string, string> = {}
      if (stAttr) {
        for (const part of stAttr.value.split(';')) {
          const [k, v] = part.split(':')
          if (k && v) inSt[k.trim()] = v.trim()
        }
      }

      const inh: Record<string, string> = {}
      for (const k of ['font-family', 'font-size', 'font-weight', 'font-style', 'color']) {
        if (inherited[k]) inh[k] = inherited[k]
      }
      const cur = { ...inh, ...nStyles, ...inSt }

      if (tn === 'strong' || tn === 'b') cur['font-weight'] = cur['font-weight'] || 'bold'
      if (tn === 'em' || tn === 'i') cur['font-style'] = cur['font-style'] || 'italic'

      const segs: ColorSegment[] = []
      if (n.childNodes) {
        for (const c of n.childNodes) segs.push(...extractInlineSegments(c, cur, childChain))
      }
      return segs
    }

    /**
     * Build a single flattened text node (with styled colorSegments) for an
     * inline-only container and attach it to the given parent custom node.
     * Returns true if flattening was performed.
     */
    const flattenInlineChildren = (
      parentNode: any,
      parentStyles: Record<string, string>,
      parentYoga: Node,
      parentCustom: CustomNode,
      chain: Array<{ tagName: string, classes: string[], id?: string }>
    ): boolean => {
      // Extract segments from each child of the parent container (not the parent itself,
      // since <p>/<h1>/etc. are not in FLATTENABLE_INLINE).
      const segments: ColorSegment[] = []
      if (parentNode.childNodes) {
        for (const child of parentNode.childNodes) {
          segments.push(...extractInlineSegments(child, parentStyles, chain))
        }
      }
      // Trim leading/trailing whitespace from the combined text
      if (segments.length > 0) {
        segments[0] = { ...segments[0]!, text: segments[0]!.text.replace(/^\s+/, '') }
        segments[segments.length - 1] = { ...segments[segments.length - 1]!, text: segments[segments.length - 1]!.text.replace(/\s+$/, '') }
      }
      const cleaned = segments.filter(s => s.text.length > 0)
      const combinedText = cleaned.map(s => s.text).join('')
      if (!combinedText) return false

      const fontSize = parseInt(parentStyles['font-size'] || '14', 10)
      const fontPath = LayoutEngine.resolveFontPath(parentStyles)
      const lineHeightRaw = parentStyles['line-height']
      let lhMul = 0
      if (lineHeightRaw) {
        const p = parseFloat(lineHeightRaw)
        if (!isNaN(p)) lhMul = lineHeightRaw.endsWith('px') ? p / fontSize : p
      }

      const textYoga = Yoga.Node.create()
      textYoga.setMeasureFunc((width, widthMode) => {
        const textWidth = textMeasurer.measureWidth(combinedText, fontSize, fontPath)
        const oneLineH = textMeasurer.measureHeight(fontSize, lhMul)
        let avail: number
        if (widthMode === Yoga.MEASURE_MODE_EXACTLY) avail = width
        else if (widthMode === Yoga.MEASURE_MODE_AT_MOST) avail = width
        else avail = textWidth
        if (avail <= 0) return { width: textWidth, height: oneLineH }
        const lines = textMeasurer.countLines(combinedText, fontSize, avail, fontPath)
        const ta = parentStyles['text-align'] || 'left'
        const full = ta === 'right' || ta === 'center' || ta === 'justify'
        let rw: number
        if (widthMode === Yoga.MEASURE_MODE_AT_MOST) rw = full ? width : Math.min(textWidth, width)
        else if (widthMode === Yoga.MEASURE_MODE_EXACTLY) rw = width
        else rw = textWidth
        return { width: rw, height: oneLineH * lines }
      })
      textYoga.setWidthPercent(100)

      const textStyles: Record<string, string> = {}
      for (const k of ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align', 'line-height', 'border-collapse']) {
        if (parentStyles[k]) textStyles[k] = parentStyles[k]
      }

      parentYoga.insertChild(textYoga, parentYoga.getChildCount())
      parentCustom.children.push({
        yogaNode: textYoga,
        data: { type: 'text', content: combinedText, styles: textStyles, colorSegments: cleaned },
        children: []
      })
      return true
    }

    const traverse = (node: any, parentCustomNode: CustomNode, inheritedStyles: Record<string, string>, parentIsRow: boolean = false, ancestorChain: Array<{ tagName: string, classes: string[], id?: string }> = [], tableRowCounter?: { count: number }, tableInfo?: TableColumnInfo, elementIndex?: number, siblingCount?: number) => {
      if (node.nodeName === '#text') {
        const text = node.value.trim()
        if (text) {
          const textYogaNode = Yoga.Node.create()
          const fontSize = parseInt(inheritedStyles['font-size'] || '14', 10)

          // Resolve the correct font file for measurement (matches rendering font)
          const fontPath = LayoutEngine.resolveFontPath(inheritedStyles)

          // Parse line-height: supports multiplier (1.5) or px ("24px")
          const lineHeightRaw = inheritedStyles['line-height']
          let lineHeightMultiplier = 0 // 0 → use font-metric default
          if (lineHeightRaw) {
            const parsed = parseFloat(lineHeightRaw)
            if (!isNaN(parsed)) {
              lineHeightMultiplier = lineHeightRaw.endsWith('px') ? parsed / fontSize : parsed
            }
          }

          textYogaNode.setMeasureFunc((width, widthMode) => {
            const textWidth = textMeasurer.measureWidth(text, fontSize, fontPath)
            const oneLineH = textMeasurer.measureHeight(fontSize, lineHeightMultiplier)

            // Determine available width for line-counting
            let availableWidth: number
            if (widthMode === Yoga.MEASURE_MODE_EXACTLY) {
              availableWidth = width
            } else if (widthMode === Yoga.MEASURE_MODE_AT_MOST) {
              availableWidth = width
            } else {
              availableWidth = textWidth
            }

            if (availableWidth <= 0) {
              return { width: textWidth, height: oneLineH }
            }

            const lineCount = textMeasurer.countLines(text, fontSize, availableWidth, fontPath)
            // When text-align is right/center/justify, the text node must
            // occupy the full available width so PDFKit has room to align.
            const textAlignVal = inheritedStyles['text-align'] || 'left'
            const needsFullWidth = textAlignVal === 'right' || textAlignVal === 'center' || textAlignVal === 'justify'
            let reportedWidth: number
            if (widthMode === Yoga.MEASURE_MODE_AT_MOST) {
              reportedWidth = needsFullWidth ? width : Math.min(textWidth, width)
            } else if (widthMode === Yoga.MEASURE_MODE_EXACTLY) {
              reportedWidth = width
            } else {
              reportedWidth = textWidth
            }
            return { width: reportedWidth, height: oneLineH * lineCount }
          })

          // In row containers, make text nodes fill available width.
          // This ensures text-align: right/center/justify works correctly
          // (PDFKit needs the full container width for alignment).
          if (parentIsRow) {
            textYogaNode.setFlexGrow(1)
            textYogaNode.setFlexShrink(1)
          } else {
            // In column containers (divs, table cells), explicitly constrain
            // the text to the parent's width.  Without this, Yoga's flex-shrink
            // on the parent may not propagate to text leaf nodes, causing the
            // text computed width to exceed the cell and overflow visually.
            textYogaNode.setWidthPercent(100)
          }

          // Only keep inheritable / typography styles for text nodes.
          // Non-inheritable styles like border, background, padding belong
          // to the parent element and must NOT be stored on the text node
          // or the renderer will draw duplicate borders/backgrounds.
          const textStyles: Record<string, string> = {}
          const textInheritable = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align', 'line-height', 'border-collapse']
          for (const k of textInheritable) {
            if (inheritedStyles[k]) textStyles[k] = inheritedStyles[k]
          }

          parentCustomNode.yogaNode.insertChild(textYogaNode, parentCustomNode.yogaNode.getChildCount())
          parentCustomNode.children.push({
            yogaNode: textYogaNode,
            data: { type: 'text', content: text, styles: textStyles },
            children: []
          })
        }
        return
      }

      if (node.nodeName && !node.nodeName.startsWith('#')) {
        const tagName = node.nodeName
        const attrs = node.attrs || []
        const classAttr = attrs.find((a: any) => a.name === 'class')
        const idAttr = attrs.find((a: any) => a.name === 'id')

        const parsedAttrs: Record<string, string> = {}
        for (const attr of attrs) {
          parsedAttrs[attr.name] = attr.value
        }

        const classes = classAttr ? classAttr.value.split(' ') : []
        const id = idAttr ? idAttr.value : undefined

        const nodeStyles = styleResolver.resolve(tagName, classes, id, ancestorChain, elementIndex, siblingCount)

        // Build the ancestor chain for children
        const childAncestorChain = [...ancestorChain, { tagName, classes, id }]

        // Parse inline styles
        const styleAttr = attrs.find((a: any) => a.name === 'style')
        const inlineStyles: Record<string, string> = {}
        if (styleAttr) {
          const styleParts = styleAttr.value.split(';')
          for (const part of styleParts) {
            const [key, value] = part.split(':')
            if (key && value) {
              inlineStyles[key.trim()] = value.trim()
            }
          }
        }

        // Only inherit typography styles
        const inheritableStyles = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align', 'line-height', 'border-collapse', 'white-space']
        const filteredInheritedStyles: Record<string, string> = {}
        for (const key of inheritableStyles) {
          if (inheritedStyles[key]) {
            filteredInheritedStyles[key] = inheritedStyles[key]
          }
        }

        const currentStyles = { ...filteredInheritedStyles, ...nodeStyles, ...inlineStyles }

        // Default block styles
        if (tagName === 'div') {
          if (!currentStyles['display']) {
            currentStyles['display'] = 'flex'
            currentStyles['flex-direction'] = 'column'
          }
          // Don't force width:100% on absolutely positioned divs
          if (!parentIsRow && currentStyles['position'] !== 'absolute') {
            currentStyles['width'] = currentStyles['width'] || '100%'
          } else if (parentIsRow && !currentStyles['width'] && !currentStyles['flex'] && !currentStyles['flex-grow']) {
            // In flex-row containers, block children should grow to fill available space
            currentStyles['flex-grow'] = '1'
            currentStyles['flex-shrink'] = '1'
            currentStyles['flex-basis'] = currentStyles['flex-basis'] || '0%'
          }
        } else if (tagName === 'h1') {
          currentStyles['font-size'] = currentStyles['font-size'] || '24px'
          currentStyles['font-weight'] = currentStyles['font-weight'] || 'bold'
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '10px'
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row'
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap'
        } else if (tagName === 'h2') {
          currentStyles['font-size'] = currentStyles['font-size'] || '18px'
          currentStyles['font-weight'] = currentStyles['font-weight'] || 'bold'
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '10px'
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row'
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap'
        } else if (tagName === 'h3') {
          currentStyles['font-size'] = currentStyles['font-size'] || '16px'
          currentStyles['font-weight'] = currentStyles['font-weight'] || 'bold'
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '10px'
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row'
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap'
        } else if (tagName === 'p') {
          currentStyles['font-size'] = currentStyles['font-size'] || '16px'
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '10px'
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row'
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap'
        } else if (tagName === 'table') {
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'column'
          currentStyles['width'] = currentStyles['width'] || '100%'
          // Create a table-wide row counter for border-collapse
          if (currentStyles['border-collapse'] === 'collapse') {
            tableRowCounter = { count: 0 }
          }
          // Create column info tracker — first row's widths will be
          // captured and applied to all subsequent rows so that column
          // widths are consistent between thead and tbody.
          tableInfo = { columnWidths: [], firstRowDone: false, cellIndex: 0 }
        } else if (tagName === 'thead' || tagName === 'tbody' || tagName === 'tfoot') {
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'column'
          currentStyles['width'] = currentStyles['width'] || '100%'
        } else if (tagName === 'tr') {
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row'
          currentStyles['width'] = currentStyles['width'] || '100%'
          // Propagate row index for border-collapse
          if (node._rowIndex !== undefined) {
            currentStyles['_rowIndex'] = String(node._rowIndex)
          }
          // Reset cell index for column width tracking
          if (tableInfo) {
            tableInfo.cellIndex = 0
          }
        } else if (tagName === 'td' || tagName === 'th') {
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'column'

          const colspanAttr = attrs.find((a: any) => a.name === 'colspan')
          const colspan = colspanAttr ? parseInt(colspanAttr.value, 10) : 1

          // Table column width propagation: apply first row's widths to
          // all subsequent rows so columns align between thead and tbody.
          if (tableInfo) {
            const ci = tableInfo.cellIndex++
            if (!tableInfo.firstRowDone) {
              // First row: capture resolved width for this column
              tableInfo.columnWidths.push(currentStyles['width'] || undefined)
            } else if (ci < tableInfo.columnWidths.length) {
              // Subsequent rows: apply first row's width if available
              const refWidth = tableInfo.columnWidths[ci]
              if (refWidth && !currentStyles['width']) {
                currentStyles['width'] = refWidth
              }
            }
          }

          if (currentStyles['width']) {
            // Cell has explicit width — use it as a fixed column,
            // don't participate in flex space distribution.
            currentStyles['flex-grow'] = currentStyles['flex-grow'] || '0'
            currentStyles['flex-shrink'] = currentStyles['flex-shrink'] || '0'
          } else {
            // Cell has no explicit width — distribute space equally via flex.
            // flex-basis: 0% with flex-grow ensures all cells get equal base
            // widths (like table-layout: fixed). colspan cells get wider share.
            // Text wrapping happens naturally within the constrained cell width.
            currentStyles['flex-grow'] = currentStyles['flex-grow'] || colspan.toString()
            currentStyles['flex-shrink'] = currentStyles['flex-shrink'] || '1'
            currentStyles['flex-basis'] = currentStyles['flex-basis'] || '0%'
          }

          if (tagName === 'th') {
            currentStyles['font-weight'] = currentStyles['font-weight'] || 'bold'
          }

          // Propagate border-collapse cell/row position from DOM node
          if (node._cellIndex !== undefined) {
            currentStyles['_cellIndex'] = String(node._cellIndex)
          }
          if (node._rowIndex !== undefined) {
            currentStyles['_rowIndex'] = String(node._rowIndex)
          }
        } else if (tagName === 'a') {
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row'
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap'
          // Preserve link styling
          if (!currentStyles['color']) currentStyles['color'] = '#1a0dab'
        } else if (tagName === 'ul' || tagName === 'ol') {
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'column'
          currentStyles['padding-left'] = currentStyles['padding-left'] || '20px'
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '10px'
          currentStyles['list-style-type'] = tagName === 'ul' ? 'disc' : 'decimal'
        } else if (tagName === 'li') {
          // Detect if this <li> contains block-level children (nested lists, etc.)
          const BLOCK_TAGS = ['ul', 'ol', 'div', 'p', 'table', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']
          const hasBlockChild = node.childNodes?.some((c: any) => BLOCK_TAGS.includes(c.nodeName))
          currentStyles['display'] = currentStyles['display'] || 'flex'
          if (hasBlockChild) {
            // Column layout so inline text sits above nested blocks
            currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'column'
          } else {
            currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row'
            currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap'
          }
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '5px'
        } else if (tagName === 'strong' || tagName === 'b') {
          currentStyles['font-weight'] = currentStyles['font-weight'] || 'bold'
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row'
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap'
        } else if (tagName === 'em' || tagName === 'i') {
          currentStyles['font-style'] = currentStyles['font-style'] || 'italic'
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row'
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap'
        } else if (tagName === 'span') {
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row'
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap'
        } else if (tagName === 'pre') {
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'column'
          currentStyles['width'] = currentStyles['width'] || '100%'
          currentStyles['white-space'] = currentStyles['white-space'] || 'pre'
          currentStyles['overflow'] = currentStyles['overflow'] || 'hidden'
        } else if (tagName === 'code') {
          currentStyles['display'] = currentStyles['display'] || 'flex'
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row'
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap'
        } else if (['header', 'footer', 'main', 'section', 'article', 'aside', 'nav', 'figure', 'figcaption', 'blockquote', 'address', 'hgroup'].includes(tagName)) {
          // HTML5 semantic elements — treat like div
          if (!currentStyles['display']) {
            currentStyles['display'] = 'flex'
            currentStyles['flex-direction'] = 'column'
          }
          if (!parentIsRow && currentStyles['position'] !== 'absolute') {
            currentStyles['width'] = currentStyles['width'] || '100%'
          } else if (parentIsRow && !currentStyles['width'] && !currentStyles['flex'] && !currentStyles['flex-grow']) {
            currentStyles['flex-grow'] = '1'
            currentStyles['flex-shrink'] = '1'
            currentStyles['flex-basis'] = currentStyles['flex-basis'] || '0%'
          }
        } else if (tagName === 'br') {
          // BR is a zero-size element; the renderer will handle it as a newline
          currentStyles['width'] = '0px'
          currentStyles['height'] = '0px'
        }

        const blockYogaNode = Yoga.Node.create()
        YogaMapper.applyStyles(blockYogaNode, currentStyles)

        // Handle specific elements like img and svg
        if (tagName === 'img' || tagName === 'svg') {
          const widthAttr = parsedAttrs['width']
          const heightAttr = parsedAttrs['height']
          if (widthAttr) blockYogaNode.setWidth(parseFloat(widthAttr))
          if (heightAttr) blockYogaNode.setHeight(parseFloat(heightAttr))
        }

        // Only add to parent if it's a visible block
        if (['body', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'strong', 'b', 'em', 'i', 'br', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'img', 'svg', 'ul', 'ol', 'li', 'a', 'pre', 'code', 'header', 'footer', 'main', 'section', 'article', 'aside', 'nav', 'figure', 'figcaption', 'blockquote', 'address', 'hgroup'].includes(tagName)) {
          parentCustomNode.yogaNode.insertChild(blockYogaNode, parentCustomNode.yogaNode.getChildCount())

          let content = undefined
          let listIndex = undefined
          if (tagName === 'svg') {
            // Serialize the SVG node back to string
            const parse5 = require('parse5')
            content = parse5.serializeOuter(node)
          }
          if (tagName === 'li') {
            listIndex = node._listIndex
          }

          const customNode: CustomNode = {
            yogaNode: blockYogaNode,
            data: { type: 'block', tagName, attrs: parsedAttrs, styles: currentStyles, content, listIndex },
            children: []
          }
          parentCustomNode.children.push(customNode)

          if (tagName === 'pre' && node.childNodes) {
            // ── Special handling for <pre>: flatten all descendant text ──
            // Code blocks (pre > code) have deeply nested spans with
            // inline style="color:..." for syntax highlighting.
            // We extract both the flat text AND colored segments so the
            // renderer can draw each token in its correct color.
            //
            // The <pre> may contain a <div class="code-lang-badge"> before
            // <code>; we only extract text from the <code> child.
            const extractAllText = (n: any): string => {
              if (n.nodeName === '#text') return n.value || ''
              let t = ''
              if (n.childNodes) for (const c of n.childNodes) t += extractAllText(c)
              return t
            }

            /** Extract colored segments: [ { text, color? }, … ] */
            const extractColorSegments = (n: any, inheritedColor?: string): ColorSegment[] => {
              if (n.nodeName === '#text') {
                const val = n.value || ''
                if (!val) return []
                return [{ text: val, color: inheritedColor }]
              }
              // Skip the language badge div — it's not code content
              if (n.nodeName === 'div') return []
              // Check for inline style color on this element (e.g. <span style="color:#d73a49">)
              let color = inheritedColor
              if (n.attrs) {
                const styleAttr = (n.attrs as any[]).find((a: any) => a.name === 'style')
                if (styleAttr) {
                  const m = (styleAttr.value as string).match(/color\s*:\s*([^;]+)/)
                  if (m) color = m[1]!.trim()
                }
              }
              const segs: ColorSegment[] = []
              if (n.childNodes) {
                for (const c of n.childNodes) segs.push(...extractColorSegments(c, color))
              }
              return segs
            }

            // Resolve <code> child styles (font-size, line-height) if present
            const codeChild = node.childNodes.find((c: any) => c.nodeName === 'code')
            let preTextStyles = { ...currentStyles }
            if (codeChild) {
              const codeAttrs = codeChild.attrs || []
              const codeClassAttr = codeAttrs.find((a: any) => a.name === 'class')
              const codeClasses = codeClassAttr ? codeClassAttr.value.split(' ') : []
              const codeNodeStyles = styleResolver.resolve('code', codeClasses, undefined, childAncestorChain, undefined, undefined)
              preTextStyles = { ...preTextStyles, ...codeNodeStyles }
              const codeStyleAttr = codeAttrs.find((a: any) => a.name === 'style')
              if (codeStyleAttr) {
                for (const part of codeStyleAttr.value.split(';')) {
                  const [key, value] = part.split(':')
                  if (key && value) preTextStyles[key.trim()] = value.trim()
                }
              }
            }
            preTextStyles['white-space'] = 'pre'

            let rawText = extractAllText(codeChild || node)
            // Trim leading/trailing blank lines from HTML formatting
            rawText = rawText.replace(/^\n+/, '').replace(/\n+$/, '')

            if (rawText) {
              const fontSize = parseInt(preTextStyles['font-size'] || '14', 10)
              const fontPath = LayoutEngine.resolveFontPath(preTextStyles)
              const lineHeightRaw = preTextStyles['line-height']
              let lineHeightMultiplier = 0
              if (lineHeightRaw) {
                const parsed = parseFloat(lineHeightRaw)
                if (!isNaN(parsed)) {
                  lineHeightMultiplier = lineHeightRaw.endsWith('px') ? parsed / fontSize : parsed
                }
              }

              const textYogaNode = Yoga.Node.create()
              textYogaNode.setMeasureFunc((_width, _widthMode) => {
                const lines = rawText.split('\n')
                const maxLineWidth = lines.reduce((max, line) => {
                  const w = line ? textMeasurer.measureWidth(line, fontSize, fontPath) : 0
                  return Math.max(max, w)
                }, 0)
                const oneLineH = textMeasurer.measureHeight(fontSize, lineHeightMultiplier)
                return { width: maxLineWidth, height: oneLineH * Math.max(1, lines.length) }
              })
              textYogaNode.setWidthPercent(100)

              const leafStyles: Record<string, string> = {}
              for (const k of ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align', 'line-height', 'white-space']) {
                if (preTextStyles[k]) leafStyles[k] = preTextStyles[k]
              }

              // Extract color segments for syntax highlighting
              const rawSegments = extractColorSegments(codeChild || node)
              // Trim leading/trailing blank lines from segments too
              // (the rawText has already been trimmed above)
              const colorSegments = rawSegments.length > 0 ? rawSegments : undefined

              blockYogaNode.insertChild(textYogaNode, blockYogaNode.getChildCount())
              customNode.children.push({
                yogaNode: textYogaNode,
                data: { type: 'text', content: rawText, styles: leafStyles, colorSegments },
                children: []
              })
            }
          } else if (tagName !== 'svg' && node.childNodes) {
            let liIndex = 1
            let childRowIndex = 0

            // Compute element sibling count for :first-child/:last-child support
            const elementChildren = node.childNodes.filter((c: any) => c.nodeName && !c.nodeName.startsWith('#'))
            const totalElementChildren = elementChildren.length

            // Check if this is an inline container with <br> that needs line splitting
            const hasBr = node.childNodes.some((c: any) => c.nodeName === 'br')
            const isInlineContainer = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)

            // Detect <li> with block-level children (nested lists)
            const INLINE_NODE_NAMES = new Set(['#text', 'strong', 'b', 'em', 'i', 'span', 'a', 'code', 'br', 'img', 'label', 'input', 's', 'del', 'sub', 'sup', 'mark', 'small', 'abbr', 'time', 'u'])
            const isLiWithBlocks = tagName === 'li' && currentStyles['flex-direction'] === 'column'
              && node.childNodes?.some((c: any) => !INLINE_NODE_NAMES.has(c.nodeName))

            // ── Inline flattening: merge strong/em/code into a single text node ──
            const shouldFlatten = (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].includes(tagName))
              && !isLiWithBlocks
              && canFlattenInline(node)
              && hasStyledInlineChild(node)

            if (shouldFlatten) {
              // Override to column for a single flattened text child
              blockYogaNode.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN)
              flattenInlineChildren(node, currentStyles, blockYogaNode, customNode, childAncestorChain)
            } else if (isLiWithBlocks) {
              // Group consecutive inline children into row wrappers;
              // block children (ul, ol, …) become direct column children.
              interface ChildGroup {
                type: 'inline' | 'block'
                children: any[]
              }
              const groups: ChildGroup[] = []
              let currentInline: any[] = []
              for (const child of node.childNodes) {
                if (INLINE_NODE_NAMES.has(child.nodeName)) {
                  currentInline.push(child)
                } else {
                  if (currentInline.length > 0) {
                    groups.push({ type: 'inline', children: currentInline })
                    currentInline = []
                  }
                  groups.push({ type: 'block', children: [child] })
                }
              }
              if (currentInline.length > 0) {
                groups.push({ type: 'inline', children: currentInline })
              }

              let elIdx = 0
              let liIdx = 1
              for (const group of groups) {
                if (group.type === 'inline') {
                  // Skip groups that are only whitespace text
                  const hasContent = group.children.some((c: any) =>
                    c.nodeName !== '#text' || (c.value && c.value.trim())
                  )
                  if (!hasContent) continue

                  // Try to flatten styled inline groups into a single text node
                  const groupHasStyled = group.children.some((c: any) => STYLED_INLINE.has(c.nodeName))
                  if (groupHasStyled) {
                    // Create a virtual wrapper node to extract segments from
                    const virtualNode = { childNodes: group.children }
                    const allInline = group.children.every((c: any) => {
                      if (c.nodeName === '#text' || c.nodeName === '#comment') return true
                      return FLATTENABLE_INLINE.has(c.nodeName) && canFlattenInline(c)
                    })
                    if (allInline) {
                      const textYoga = Yoga.Node.create()
                      // Extract segments
                      const gSegments: ColorSegment[] = []
                      for (const c of group.children) {
                        gSegments.push(...extractInlineSegments(c, currentStyles, childAncestorChain))
                      }
                      if (gSegments.length > 0) {
                        gSegments[0] = { ...gSegments[0]!, text: gSegments[0]!.text.replace(/^\s+/, '') }
                        gSegments[gSegments.length - 1] = { ...gSegments[gSegments.length - 1]!, text: gSegments[gSegments.length - 1]!.text.replace(/\s+$/, '') }
                      }
                      const cleaned = gSegments.filter(s => s.text.length > 0)
                      const combined = cleaned.map(s => s.text).join('')
                      if (combined) {
                        const fontSize = parseInt(currentStyles['font-size'] || '14', 10)
                        const fontPath = LayoutEngine.resolveFontPath(currentStyles)
                        const lhRaw = currentStyles['line-height']
                        let lhM = 0
                        if (lhRaw) { const p = parseFloat(lhRaw); if (!isNaN(p)) lhM = lhRaw.endsWith('px') ? p / fontSize : p }
                        textYoga.setMeasureFunc((width, widthMode) => {
                          const tw = textMeasurer.measureWidth(combined, fontSize, fontPath)
                          const oh = textMeasurer.measureHeight(fontSize, lhM)
                          let av: number
                          if (widthMode === Yoga.MEASURE_MODE_EXACTLY) av = width
                          else if (widthMode === Yoga.MEASURE_MODE_AT_MOST) av = width
                          else av = tw
                          if (av <= 0) return { width: tw, height: oh }
                          const lns = textMeasurer.countLines(combined, fontSize, av, fontPath)
                          return { width: widthMode === Yoga.MEASURE_MODE_AT_MOST ? Math.min(tw, width) : (widthMode === Yoga.MEASURE_MODE_EXACTLY ? width : tw), height: oh * lns }
                        })
                        textYoga.setWidthPercent(100)
                        const tStyles: Record<string, string> = {}
                        for (const k of ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align', 'line-height']) {
                          if (currentStyles[k]) tStyles[k] = currentStyles[k]
                        }
                        blockYogaNode.insertChild(textYoga, blockYogaNode.getChildCount())
                        customNode.children.push({
                          yogaNode: textYoga,
                          data: { type: 'text', content: combined, styles: tStyles, colorSegments: cleaned },
                          children: []
                        })
                        continue
                      }
                    }
                  }

                  // Fallback: normal row wrapper
                  const rowYoga = Yoga.Node.create()
                  rowYoga.setDisplay(Yoga.DISPLAY_FLEX)
                  rowYoga.setFlexDirection(Yoga.FLEX_DIRECTION_ROW)
                  rowYoga.setFlexWrap(Yoga.WRAP_WRAP)
                  blockYogaNode.insertChild(rowYoga, blockYogaNode.getChildCount())
                  const rowCustom: CustomNode = {
                    yogaNode: rowYoga,
                    data: { type: 'block', tagName: '__line__', attrs: {}, styles: { ...currentStyles, display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap' } },
                    children: []
                  }
                  customNode.children.push(rowCustom)
                  for (const child of group.children) {
                    const childElIdx = (child.nodeName && !child.nodeName.startsWith('#')) ? elIdx++ : undefined
                    traverse(child, rowCustom, currentStyles, true, childAncestorChain, tableRowCounter, tableInfo, childElIdx, totalElementChildren)
                  }
                } else {
                  for (const child of group.children) {
                    if (child.nodeName === 'li') child._listIndex = liIdx++
                    const childElIdx = (child.nodeName && !child.nodeName.startsWith('#')) ? elIdx++ : undefined
                    traverse(child, customNode, currentStyles, false, childAncestorChain, tableRowCounter, tableInfo, childElIdx, totalElementChildren)
                  }
                }
              }
            } else if (hasBr && isInlineContainer) {
              // Group children into lines split by <br>, create a row node for each line
              const lines: any[][] = [[]]
              for (const child of node.childNodes) {
                if (child.nodeName === 'br') {
                  lines.push([])
                } else {
                  lines[lines.length - 1]!.push(child)
                }
              }
              // Override to column to stack lines
              blockYogaNode.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN)
              let elIdx = 0
              for (const lineChildren of lines) {
                if (lineChildren.length === 0) continue
                const lineYogaNode = Yoga.Node.create()
                lineYogaNode.setDisplay(Yoga.DISPLAY_FLEX)
                lineYogaNode.setFlexDirection(Yoga.FLEX_DIRECTION_ROW)
                lineYogaNode.setFlexWrap(Yoga.WRAP_WRAP)
                blockYogaNode.insertChild(lineYogaNode, blockYogaNode.getChildCount())
                const lineCustomNode: CustomNode = {
                  yogaNode: lineYogaNode,
                  data: { type: 'block', tagName: '__line__', attrs: {}, styles: { ...currentStyles, display: 'flex', 'flex-direction': 'row' } },
                  children: []
                }
                customNode.children.push(lineCustomNode)
                for (const child of lineChildren) {
                  const childElIdx = (child.nodeName && !child.nodeName.startsWith('#')) ? elIdx++ : undefined
                  traverse(child, lineCustomNode, currentStyles, true, childAncestorChain, tableRowCounter, tableInfo, childElIdx, totalElementChildren)
                }
              }
            } else {
              const isRow = currentStyles['display'] === 'flex' && (currentStyles['flex-direction'] === 'row' || !currentStyles['flex-direction'])
              let cellIndex = 0
              let elIdx = 0
              for (const child of node.childNodes) {
                if (child.nodeName === 'li') {
                  child._listIndex = liIndex++
                }
                // Track row/cell indices for border-collapse (table-wide counter)
                if (child.nodeName === 'tr') {
                  child._rowIndex = tableRowCounter ? tableRowCounter.count++ : childRowIndex++
                }
                if ((child.nodeName === 'td' || child.nodeName === 'th') && currentStyles['border-collapse'] === 'collapse') {
                  child._cellIndex = cellIndex++
                  child._rowIndex = node._rowIndex
                }
                const childElIdx = (child.nodeName && !child.nodeName.startsWith('#')) ? elIdx++ : undefined
                traverse(child, customNode, currentStyles, isRow, childAncestorChain, tableRowCounter, tableInfo, childElIdx, totalElementChildren)
              }
              // After processing a <tr>'s children, mark first row as done
              // so subsequent rows apply (rather than capture) column widths.
              if (tagName === 'tr' && tableInfo && !tableInfo.firstRowDone) {
                tableInfo.firstRowDone = true
              }
            }
          }
        } else {
          // If not a block we care about, just traverse children and attach to parent
          if (node.childNodes) {
            for (const child of node.childNodes) {
              traverse(child, parentCustomNode, currentStyles, parentIsRow, ancestorChain, tableRowCounter, tableInfo)
            }
          }
        }
      }
    }

    // Find the body tag to start traversal
    const htmlNode = dom.childNodes.find((n: any) => n.nodeName === 'html')
    if (htmlNode) {
      const bodyNode = htmlNode.childNodes.find((n: any) => n.nodeName === 'body')
      if (bodyNode) {
        traverse(bodyNode, customRoot, {})
      }
    }

    // Calculate layout
    rootYogaNode.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR)

    // Build final layout tree
    const buildLayoutTree = (customNode: CustomNode, parentX: number, parentY: number): LayoutNode => {
      const { yogaNode, data } = customNode

      const x = parentX + yogaNode.getComputedLeft()
      const y = parentY + yogaNode.getComputedTop()
      const width = yogaNode.getComputedWidth()
      const height = yogaNode.getComputedHeight()

      const layoutNode: LayoutNode = {
        type: data.type as any,
        tagName: data.tagName,
        content: data.content,
        attrs: data.attrs,
        x,
        y,
        width,
        height,
        styles: data.styles || {},
        children: [],
        listIndex: data.listIndex,
        colorSegments: data.colorSegments,
      }

      for (const child of customNode.children) {
        layoutNode.children.push(buildLayoutTree(child, x, y))
      }

      return layoutNode
    }

    const rootLayout = buildLayoutTree(customRoot, 0, 0)

    // Post-layout pass: normalize table column widths.
    // Yoga computes each flex-row independently, so thead and tbody cells
    // may end up with different widths.  This pass forces all rows within a
    // table to share the same column-width distribution, supporting colspan.
    //
    // Strategy:
    //   1. Find the "base row" — the row with the highest number of cells
    //      (excluding colspan-expanded cells) which defines individual column widths.
    //   2. Build a column-width array from the base row.
    //   3. For each other row, reposition cells:
    //      - Normal cells get the width of their corresponding column.
    //      - Colspan cells get the sum of the spanned columns' widths.
    const normalizeTableColumns = (node: LayoutNode) => {
      if (node.tagName === 'table') {
        // Collect all rows across thead/tbody/tfoot
        const allRows: LayoutNode[] = []
        for (const section of node.children) {
          if (section.tagName === 'thead' || section.tagName === 'tbody' || section.tagName === 'tfoot') {
            for (const row of section.children) {
              if (row.tagName === 'tr') allRows.push(row)
            }
          } else if (section.tagName === 'tr') {
            allRows.push(section)
          }
        }

        if (allRows.length < 1) {
          for (const child of node.children) normalizeTableColumns(child)
          return
        }

        // Determine the logical column count for each row (accounting for colspan)
        const getLogicalColCount = (row: LayoutNode): number => {
          let count = 0
          for (const cell of row.children) {
            if (cell.tagName === 'td' || cell.tagName === 'th') {
              const cs = parseInt(cell.attrs?.['colspan'] || '1', 10)
              count += Math.max(1, cs)
            }
          }
          return count
        }

        // Find the maximum logical column count across all rows
        const maxCols = Math.max(...allRows.map(getLogicalColCount))
        if (maxCols === 0) {
          for (const child of node.children) normalizeTableColumns(child)
          return
        }

        // Find the "base row" — the row that has `maxCols` cells each with colspan=1.
        // This row defines individual column widths.
        // If no such row exists, find the row with the most physical cells and expand.
        let baseRow: LayoutNode | null = null
        for (const row of allRows) {
          const cells = row.children.filter(c => c.tagName === 'td' || c.tagName === 'th')
          const allSingleSpan = cells.every(c => parseInt(c.attrs?.['colspan'] || '1', 10) === 1)
          if (allSingleSpan && cells.length === maxCols) {
            baseRow = row
            break
          }
        }

        // Build individual column widths from the base row
        let colWidths: number[]
        if (baseRow) {
          const baseCells = baseRow.children.filter(c => c.tagName === 'td' || c.tagName === 'th')
          colWidths = baseCells.map(c => c.width)
        } else {
          // No row with all single-span = maxCols cells.
          // Distribute the table content width equally across maxCols columns.
          const tableWidth = node.width
          const colW = tableWidth / maxCols
          colWidths = Array(maxCols).fill(colW)
        }

        // Apply column widths to all rows
        for (const row of allRows) {
          const cells = row.children.filter(c => c.tagName === 'td' || c.tagName === 'th')
          const logicalCount = getLogicalColCount(row)
          if (logicalCount !== maxCols && logicalCount > 0) {
            // Row doesn't match expected column count — try to handle
            // as best we can; might be a malformed table.
          }

          let colIdx = 0
          let xOffset = row.x
          for (const cell of cells) {
            const cs = Math.max(1, parseInt(cell.attrs?.['colspan'] || '1', 10))
            // Calculate target width as sum of spanned columns
            let targetWidth = 0
            for (let c = 0; c < cs && (colIdx + c) < colWidths.length; c++) {
              targetWidth += colWidths[colIdx + c]!
            }
            // If we don't have enough column info, use the cell's own width
            if (targetWidth <= 0) targetWidth = cell.width

            const dx = xOffset - cell.x
            if (dx !== 0) shiftSubtreeX(cell, dx)
            cell.width = targetWidth

            // Also resize text children to match new cell width
            for (const child of cell.children) {
              if (child.type === 'text') {
                child.width = Math.max(0, targetWidth - (cell.styles['padding-left'] ? parseFloat(cell.styles['padding-left']) : 0) - (cell.styles['padding-right'] ? parseFloat(cell.styles['padding-right']) : 0))
              }
            }

            xOffset += targetWidth
            colIdx += cs
          }
        }
      }
      for (const child of node.children) normalizeTableColumns(child)
    }

    /** Shift a layout node and descendants horizontally */
    const shiftSubtreeX = (node: LayoutNode, dx: number) => {
      node.x += dx
      for (const child of node.children) shiftSubtreeX(child, dx)
    }

    normalizeTableColumns(rootLayout)

    // Post-layout pass: comprehensive page flow
    // (page-break-before/after, margin enforcement, row integrity, break-inside)
    applyPageFlow(rootLayout, pageMargin, pageHeight)

    // Post-layout pass: orphans / widows
    applyOrphansWidows(rootLayout, pageMargin, pageHeight)

    // Post-layout pass: shift content after multi-page tables with repeated thead
    applyTheadRepeatShift(rootLayout, pageMargin, pageHeight)

    // Lightweight cleanup: fix header/footer zone violations caused by
    // orphans/widows or thead-repeat shifts without re-applying complex rules.
    applyMarginZoneCleanup(rootLayout, pageMargin, pageHeight)

    // Compact stale page-break gaps inside table rows.
    compactTableRowGaps(rootLayout, pageMargin, pageHeight)

    // Fix rows in header zones or straddling page boundaries.
    fixTableRowPositions(rootLayout, pageMargin, pageHeight)

    // Compact stale same-page gaps between siblings created by the
    // interaction of applyPageFlow zone pushes + theadRepeatShift.
    compactSiblingGaps(rootLayout, pageMargin, pageHeight)

    // Final cleanup: re-run zone/row fixes after sibling compaction.
    applyMarginZoneCleanup(rootLayout, pageMargin, pageHeight)
    fixTableRowPositions(rootLayout, pageMargin, pageHeight)
    // Second compaction pass: the cleanup may have shifted elements,
    // creating new same-page gaps.
    compactSiblingGaps(rootLayout, pageMargin, pageHeight)

    // fixTableRowPositions may push rows across page boundaries, creating
    // cross-page gaps.  After compactSiblingGaps shifts the whole table,
    // those gaps become same-page gaps.  Compact them now.
    compactTableRowGaps(rootLayout, pageMargin, pageHeight)

    // Final anchor pass: ensure page-break-before: always elements sit
    // at exactly pageMargin on their current page, fixing any residual
    // drift from thead-repeat or other cascading shifts.
    anchorPageBreaks(rootLayout, pageMargin, pageHeight)

    // Free Yoga nodes to prevent memory leaks
    rootYogaNode.freeRecursive()

    return {
      rootNode: rootLayout,
      pageRules: styleResolver.getPageRules(),
      fontFaceRules: styleResolver.getFontFaceRules(),
      pageMargin,
      pageWidth,
      pageHeight,
    }
  }
}
