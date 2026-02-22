import type * as cssTree from 'css-tree'
import type { Node } from 'yoga-layout'
import Yoga from 'yoga-layout'
import { TextMeasurer } from '../text/text-measurer'
import { applyMarginZoneCleanup, applyOrphansWidows, applyPageFlow, applyTheadRepeatShift } from './page-break'
import type { FontFaceRule, PageRule } from './style-resolver'
import { StyleResolver } from './style-resolver'
import { YogaMapper } from './yoga-mapper'

export interface LayoutNode {
  type: 'document' | 'block' | 'text';
  tagName?: string;
  content?: string;
  attrs?: Record<string, string>;
  x: number;
  y: number;
  width: number;
  height: number;
  styles: Record<string, string>;
  children: LayoutNode[];
  listIndex?: number;
}

export interface LayoutResult {
  rootNode: LayoutNode;
  pageRules: PageRule[];
  fontFaceRules: FontFaceRule[];
}

export class LayoutEngine {
  /**
   * Resolve the font file path from CSS styles (font-weight, font-style).
   * Matches the rendering font so layout measurement is accurate.
   */
  private static resolveFontPath(styles: Record<string, string>): string {
    const isBold = styles['font-weight'] === 'bold' || parseInt(styles['font-weight'] || '400', 10) >= 700;
    const isItalic = styles['font-style'] === 'italic';
    if (isBold && isItalic) return 'fonts/Sarabun-BoldItalic.ttf';
    if (isBold) return 'fonts/Sarabun-Bold.ttf';
    if (isItalic) return 'fonts/Sarabun-Italic.ttf';
    return 'fonts/Sarabun-Regular.ttf';
  }

  /**
   * Calculates the layout (Box Model) based on the DOM and CSS AST using Yoga Layout.
   * @param dom The parsed HTML DOM.
   * @param styles The parsed CSS AST.
   * @returns A layout tree with calculated positions and dimensions.
   */
  static calculate(dom: any, styles: cssTree.CssNode): LayoutResult {
    const styleResolver = new StyleResolver(styles);
    const textMeasurer = new TextMeasurer('fonts/Sarabun-Regular.ttf');
    
    const rootYogaNode = Yoga.Node.create();
    rootYogaNode.setWidth(595.28); // A4 width in points
    // NOTE: No setHeight — let the document grow to whatever height content needs.
    // The renderer maps Y coordinates to PDF pages by dividing by pageHeight.
    rootYogaNode.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    rootYogaNode.setPadding(Yoga.EDGE_ALL, 50); // 50pt page margin

    interface CustomNode {
      yogaNode: Node;
      data: { type: string, tagName?: string, content?: string, attrs?: Record<string, string>, styles: Record<string, string>, listIndex?: number };
      children: CustomNode[];
    }

    const customRoot: CustomNode = {
      yogaNode: rootYogaNode,
      data: { type: 'document', styles: {} },
      children: []
    };

    /** Tracks column width configuration for a table, populated from
     *  the first row and applied to all subsequent rows. */
    interface TableColumnInfo {
      /** Resolved CSS width for each column (undefined = auto). */
      columnWidths: (string | undefined)[];
      /** Whether the first row's cells have been fully processed. */
      firstRowDone: boolean;
      /** Tracks cell index within the current row. */
      cellIndex: number;
    }

    const traverse = (node: any, parentCustomNode: CustomNode, inheritedStyles: Record<string, string>, parentIsRow: boolean = false, ancestorChain: Array<{tagName: string, classes: string[], id?: string}> = [], tableRowCounter?: { count: number }, tableInfo?: TableColumnInfo) => {
      if (node.nodeName === '#text') {
        const text = node.value.trim();
        if (text) {
          const textYogaNode = Yoga.Node.create();
          const fontSize = parseInt(inheritedStyles['font-size'] || '14', 10);

          // Resolve the correct font file for measurement (matches rendering font)
          const fontPath = LayoutEngine.resolveFontPath(inheritedStyles);

          // Parse line-height: supports multiplier (1.5) or px ("24px")
          const lineHeightRaw = inheritedStyles['line-height'];
          let lineHeightMultiplier = 0; // 0 → use font-metric default
          if (lineHeightRaw) {
            const parsed = parseFloat(lineHeightRaw);
            if (!isNaN(parsed)) {
              lineHeightMultiplier = lineHeightRaw.endsWith('px') ? parsed / fontSize : parsed;
            }
          }

          textYogaNode.setMeasureFunc((width, widthMode) => {
            const textWidth = textMeasurer.measureWidth(text, fontSize, fontPath);
            const oneLineH = textMeasurer.measureHeight(fontSize, lineHeightMultiplier);

            // Determine available width for line-counting
            let availableWidth: number;
            if (widthMode === Yoga.MEASURE_MODE_EXACTLY) {
              availableWidth = width;
            } else if (widthMode === Yoga.MEASURE_MODE_AT_MOST) {
              availableWidth = width;
            } else {
              availableWidth = textWidth;
            }

            if (availableWidth <= 0) {
              return { width: textWidth, height: oneLineH };
            }

            const lineCount = textMeasurer.countLines(text, fontSize, availableWidth, fontPath);
            // When text-align is right/center/justify, the text node must
            // occupy the full available width so PDFKit has room to align.
            const textAlignVal = inheritedStyles['text-align'] || 'left';
            const needsFullWidth = textAlignVal === 'right' || textAlignVal === 'center' || textAlignVal === 'justify';
            let reportedWidth: number;
            if (widthMode === Yoga.MEASURE_MODE_AT_MOST) {
              reportedWidth = needsFullWidth ? width : Math.min(textWidth, width);
            } else if (widthMode === Yoga.MEASURE_MODE_EXACTLY) {
              reportedWidth = width;
            } else {
              reportedWidth = textWidth;
            }
            return { width: reportedWidth, height: oneLineH * lineCount };
          });

          // In row containers, make text nodes fill available width.
          // This ensures text-align: right/center/justify works correctly
          // (PDFKit needs the full container width for alignment).
          if (parentIsRow) {
            textYogaNode.setFlexGrow(1);
            textYogaNode.setFlexShrink(1);
          } else {
            // In column containers (divs, table cells), explicitly constrain
            // the text to the parent's width.  Without this, Yoga's flex-shrink
            // on the parent may not propagate to text leaf nodes, causing the
            // text computed width to exceed the cell and overflow visually.
            textYogaNode.setWidthPercent(100);
          }

          // Only keep inheritable / typography styles for text nodes.
          // Non-inheritable styles like border, background, padding belong
          // to the parent element and must NOT be stored on the text node
          // or the renderer will draw duplicate borders/backgrounds.
          const textStyles: Record<string, string> = {};
          const textInheritable = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align', 'line-height', 'border-collapse'];
          for (const k of textInheritable) {
            if (inheritedStyles[k]) textStyles[k] = inheritedStyles[k];
          }

          parentCustomNode.yogaNode.insertChild(textYogaNode, parentCustomNode.yogaNode.getChildCount());
          parentCustomNode.children.push({
            yogaNode: textYogaNode,
            data: { type: 'text', content: text, styles: textStyles },
            children: []
          });
        }
        return;
      }

      if (node.nodeName && !node.nodeName.startsWith('#')) {
        const tagName = node.nodeName;
        const attrs = node.attrs || [];
        const classAttr = attrs.find((a: any) => a.name === 'class');
        const idAttr = attrs.find((a: any) => a.name === 'id');
        
        const parsedAttrs: Record<string, string> = {};
        for (const attr of attrs) {
          parsedAttrs[attr.name] = attr.value;
        }

        const classes = classAttr ? classAttr.value.split(' ') : [];
        const id = idAttr ? idAttr.value : undefined;

        const nodeStyles = styleResolver.resolve(tagName, classes, id, ancestorChain);

        // Build the ancestor chain for children
        const childAncestorChain = [...ancestorChain, { tagName, classes, id }];

        // Parse inline styles
        const styleAttr = attrs.find((a: any) => a.name === 'style');
        const inlineStyles: Record<string, string> = {};
        if (styleAttr) {
          const styleParts = styleAttr.value.split(';');
          for (const part of styleParts) {
            const [key, value] = part.split(':');
            if (key && value) {
              inlineStyles[key.trim()] = value.trim();
            }
          }
        }

        // Only inherit typography styles
        const inheritableStyles = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align', 'line-height', 'border-collapse'];
        const filteredInheritedStyles: Record<string, string> = {};
        for (const key of inheritableStyles) {
          if (inheritedStyles[key]) {
            filteredInheritedStyles[key] = inheritedStyles[key];
          }
        }

        const currentStyles = { ...filteredInheritedStyles, ...nodeStyles, ...inlineStyles };

        // Default block styles
        if (tagName === 'div') {
          if (!currentStyles['display']) {
            currentStyles['display'] = 'flex';
            currentStyles['flex-direction'] = 'column';
          }
          // Don't force width:100% on absolutely positioned divs
          if (!parentIsRow && currentStyles['position'] !== 'absolute') {
            currentStyles['width'] = currentStyles['width'] || '100%';
          }
        } else if (tagName === 'h1') {
          currentStyles['font-size'] = currentStyles['font-size'] || '24px';
          currentStyles['font-weight'] = currentStyles['font-weight'] || 'bold';
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '10px';
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row';
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap';
        } else if (tagName === 'h2') {
          currentStyles['font-size'] = currentStyles['font-size'] || '18px';
          currentStyles['font-weight'] = currentStyles['font-weight'] || 'bold';
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '10px';
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row';
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap';
        } else if (tagName === 'h3') {
          currentStyles['font-size'] = currentStyles['font-size'] || '16px';
          currentStyles['font-weight'] = currentStyles['font-weight'] || 'bold';
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '10px';
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row';
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap';
        } else if (tagName === 'p') {
          currentStyles['font-size'] = currentStyles['font-size'] || '16px';
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '10px';
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row';
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap';
        } else if (tagName === 'table') {
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'column';
          currentStyles['width'] = currentStyles['width'] || '100%';
          // Create a table-wide row counter for border-collapse
          if (currentStyles['border-collapse'] === 'collapse') {
            tableRowCounter = { count: 0 };
          }
          // Create column info tracker — first row's widths will be
          // captured and applied to all subsequent rows so that column
          // widths are consistent between thead and tbody.
          tableInfo = { columnWidths: [], firstRowDone: false, cellIndex: 0 };
        } else if (tagName === 'thead' || tagName === 'tbody' || tagName === 'tfoot') {
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'column';
          currentStyles['width'] = currentStyles['width'] || '100%';
        } else if (tagName === 'tr') {
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row';
          currentStyles['width'] = currentStyles['width'] || '100%';
          // Propagate row index for border-collapse
          if (node._rowIndex !== undefined) {
            currentStyles['_rowIndex'] = String(node._rowIndex);
          }
          // Reset cell index for column width tracking
          if (tableInfo) {
            tableInfo.cellIndex = 0;
          }
        } else if (tagName === 'td' || tagName === 'th') {
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'column';
          
          const colspanAttr = attrs.find((a: any) => a.name === 'colspan');
          const colspan = colspanAttr ? parseInt(colspanAttr.value, 10) : 1;

          // Table column width propagation: apply first row's widths to
          // all subsequent rows so columns align between thead and tbody.
          if (tableInfo) {
            const ci = tableInfo.cellIndex++;
            if (!tableInfo.firstRowDone) {
              // First row: capture resolved width for this column
              tableInfo.columnWidths.push(currentStyles['width'] || undefined);
            } else if (ci < tableInfo.columnWidths.length) {
              // Subsequent rows: apply first row's width if available
              const refWidth = tableInfo.columnWidths[ci];
              if (refWidth && !currentStyles['width']) {
                currentStyles['width'] = refWidth;
              }
            }
          }

          if (currentStyles['width']) {
            // Cell has explicit width — use it as a fixed column,
            // don't participate in flex space distribution.
            currentStyles['flex-grow'] = currentStyles['flex-grow'] || '0';
            currentStyles['flex-shrink'] = currentStyles['flex-shrink'] || '0';
          } else {
            // Cell has no explicit width — share remaining space equally.
            // flex-basis: 0 ensures all auto-width cells get equal widths
            // regardless of content, like table-layout: fixed.
            currentStyles['flex'] = currentStyles['flex'] || colspan.toString();
            currentStyles['flex-basis'] = currentStyles['flex-basis'] || '0px';
          }
          
          if (tagName === 'th') {
            currentStyles['font-weight'] = currentStyles['font-weight'] || 'bold';
          }

          // Propagate border-collapse cell/row position from DOM node
          if (node._cellIndex !== undefined) {
            currentStyles['_cellIndex'] = String(node._cellIndex);
          }
          if (node._rowIndex !== undefined) {
            currentStyles['_rowIndex'] = String(node._rowIndex);
          }
        } else if (tagName === 'a') {
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row';
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap';
          // Preserve link styling
          if (!currentStyles['color']) currentStyles['color'] = '#1a0dab';
        } else if (tagName === 'ul' || tagName === 'ol') {
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'column';
          currentStyles['padding-left'] = currentStyles['padding-left'] || '20px';
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '10px';
          currentStyles['list-style-type'] = tagName === 'ul' ? 'disc' : 'decimal';
        } else if (tagName === 'li') {
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row';
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap';
          currentStyles['margin-bottom'] = currentStyles['margin-bottom'] || '5px';
        } else if (tagName === 'strong' || tagName === 'b') {
          currentStyles['font-weight'] = currentStyles['font-weight'] || 'bold';
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row';
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap';
        } else if (tagName === 'em' || tagName === 'i') {
          currentStyles['font-style'] = currentStyles['font-style'] || 'italic';
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row';
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap';
        } else if (tagName === 'span') {
          currentStyles['display'] = currentStyles['display'] || 'flex';
          currentStyles['flex-direction'] = currentStyles['flex-direction'] || 'row';
          currentStyles['flex-wrap'] = currentStyles['flex-wrap'] || 'wrap';
        } else if (tagName === 'br') {
          // BR is a zero-size element; the renderer will handle it as a newline
          currentStyles['width'] = '0px';
          currentStyles['height'] = '0px';
        }

        const blockYogaNode = Yoga.Node.create();
        YogaMapper.applyStyles(blockYogaNode, currentStyles);

        // Handle specific elements like img and svg
        if (tagName === 'img' || tagName === 'svg') {
          const widthAttr = parsedAttrs['width'];
          const heightAttr = parsedAttrs['height'];
          if (widthAttr) blockYogaNode.setWidth(parseFloat(widthAttr));
          if (heightAttr) blockYogaNode.setHeight(parseFloat(heightAttr));
        }

        // Only add to parent if it's a visible block
        if (['body', 'div', 'p', 'h1', 'h2', 'h3', 'span', 'strong', 'b', 'em', 'i', 'br', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'img', 'svg', 'ul', 'ol', 'li', 'a'].includes(tagName)) {
           parentCustomNode.yogaNode.insertChild(blockYogaNode, parentCustomNode.yogaNode.getChildCount());
           
           let content = undefined;
           let listIndex = undefined;
           if (tagName === 'svg') {
             // Serialize the SVG node back to string
             const parse5 = require('parse5');
             content = parse5.serializeOuter(node);
           }
           if (tagName === 'li') {
             listIndex = node._listIndex;
           }

           const customNode: CustomNode = {
             yogaNode: blockYogaNode,
             data: { type: 'block', tagName, attrs: parsedAttrs, styles: currentStyles, content, listIndex },
             children: []
           };
           parentCustomNode.children.push(customNode);

           if (tagName !== 'svg' && node.childNodes) {
             let liIndex = 1;
             let childRowIndex = 0;

             // Check if this is an inline container with <br> that needs line splitting
             const hasBr = node.childNodes.some((c: any) => c.nodeName === 'br');
             const isInlineContainer = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName);

             if (hasBr && isInlineContainer) {
               // Group children into lines split by <br>, create a row node for each line
               const lines: any[][] = [[]];
               for (const child of node.childNodes) {
                 if (child.nodeName === 'br') {
                   lines.push([]);
                 } else {
                   lines[lines.length - 1]!.push(child);
                 }
               }
               // Override to column to stack lines
               blockYogaNode.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
               for (const lineChildren of lines) {
                 if (lineChildren.length === 0) continue;
                 const lineYogaNode = Yoga.Node.create();
                 lineYogaNode.setDisplay(Yoga.DISPLAY_FLEX);
                 lineYogaNode.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
                 lineYogaNode.setFlexWrap(Yoga.WRAP_WRAP);
                 blockYogaNode.insertChild(lineYogaNode, blockYogaNode.getChildCount());
                 const lineCustomNode: CustomNode = {
                   yogaNode: lineYogaNode,
                   data: { type: 'block', tagName: '__line__', attrs: {}, styles: { ...currentStyles, display: 'flex', 'flex-direction': 'row' } },
                   children: []
                 };
                 customNode.children.push(lineCustomNode);
                 for (const child of lineChildren) {
                   traverse(child, lineCustomNode, currentStyles, true, childAncestorChain, tableRowCounter, tableInfo);
                 }
               }
             } else {
               const isRow = currentStyles['display'] === 'flex' && (currentStyles['flex-direction'] === 'row' || !currentStyles['flex-direction']);
               let cellIndex = 0;
               for (const child of node.childNodes) {
                 if (child.nodeName === 'li') {
                   child._listIndex = liIndex++;
                 }
                 // Track row/cell indices for border-collapse (table-wide counter)
                 if (child.nodeName === 'tr') {
                   child._rowIndex = tableRowCounter ? tableRowCounter.count++ : childRowIndex++;
                 }
                 if ((child.nodeName === 'td' || child.nodeName === 'th') && currentStyles['border-collapse'] === 'collapse') {
                   child._cellIndex = cellIndex++;
                   child._rowIndex = node._rowIndex;
                 }
                 traverse(child, customNode, currentStyles, isRow, childAncestorChain, tableRowCounter, tableInfo);
               }
               // After processing a <tr>'s children, mark first row as done
               // so subsequent rows apply (rather than capture) column widths.
               if (tagName === 'tr' && tableInfo && !tableInfo.firstRowDone) {
                 tableInfo.firstRowDone = true;
               }
             }
           }
        } else {
           // If not a block we care about, just traverse children and attach to parent
           if (node.childNodes) {
             for (const child of node.childNodes) {
               traverse(child, parentCustomNode, currentStyles, parentIsRow, ancestorChain, tableRowCounter, tableInfo);
             }
           }
        }
      }
    };

    // Find the body tag to start traversal
    const htmlNode = dom.childNodes.find((n: any) => n.nodeName === 'html');
    if (htmlNode) {
      const bodyNode = htmlNode.childNodes.find((n: any) => n.nodeName === 'body');
      if (bodyNode) {
        traverse(bodyNode, customRoot, {});
      }
    }

    // Calculate layout
    rootYogaNode.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);

    // Build final layout tree
    const buildLayoutTree = (customNode: CustomNode, parentX: number, parentY: number): LayoutNode => {
      const { yogaNode, data } = customNode;
      
      const x = parentX + yogaNode.getComputedLeft();
      const y = parentY + yogaNode.getComputedTop();
      const width = yogaNode.getComputedWidth();
      const height = yogaNode.getComputedHeight();

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
        listIndex: data.listIndex
      };

      for (const child of customNode.children) {
        layoutNode.children.push(buildLayoutTree(child, x, y));
      }

      return layoutNode;
    };

    const rootLayout = buildLayoutTree(customRoot, 0, 0);
    
    // Post-layout pass: normalize table column widths.
    // Yoga computes each flex-row independently, so thead and tbody cells
    // may end up with different widths.  This pass forces all rows within a
    // table to share the same column-width distribution derived from the
    // computed widths of the first (reference) row.
    const normalizeTableColumns = (node: LayoutNode) => {
      if (node.tagName === 'table') {
        // Collect all rows across thead/tbody/tfoot
        const allRows: LayoutNode[] = [];
        for (const section of node.children) {
          if (section.tagName === 'thead' || section.tagName === 'tbody' || section.tagName === 'tfoot') {
            for (const row of section.children) {
              if (row.tagName === 'tr') allRows.push(row);
            }
          } else if (section.tagName === 'tr') {
            allRows.push(section);
          }
        }

        if (allRows.length >= 2) {
          // Use the first row as the reference for column widths
          const refRow = allRows[0]!;
          const refCells = refRow.children.filter(c => c.tagName === 'td' || c.tagName === 'th');
          if (refCells.length > 0) {
            const colWidths = refCells.map(c => c.width);

            // Apply reference widths to all subsequent rows
            for (let ri = 1; ri < allRows.length; ri++) {
              const row = allRows[ri]!;
              const cells = row.children.filter(c => c.tagName === 'td' || c.tagName === 'th');
              if (cells.length !== colWidths.length) continue; // column count mismatch → skip

              let xOffset = row.x;
              for (let ci = 0; ci < cells.length; ci++) {
                const cell = cells[ci]!;
                const targetWidth = colWidths[ci]!;
                const dx = xOffset - cell.x;
                // Shift cell and all its descendants to the correct X position
                if (dx !== 0) shiftSubtreeX(cell, dx);
                cell.width = targetWidth;
                xOffset += targetWidth;
              }
            }
          }
        }
      }
      for (const child of node.children) normalizeTableColumns(child);
    };

    /** Shift a layout node and descendants horizontally */
    const shiftSubtreeX = (node: LayoutNode, dx: number) => {
      node.x += dx;
      for (const child of node.children) shiftSubtreeX(child, dx);
    };

    normalizeTableColumns(rootLayout);

    // Post-layout pass: comprehensive page flow
    // (page-break-before/after, margin enforcement, row integrity, break-inside)
    applyPageFlow(rootLayout);

    // Post-layout pass: orphans / widows
    applyOrphansWidows(rootLayout);

    // Post-layout pass: shift content after multi-page tables with repeated thead
    applyTheadRepeatShift(rootLayout);

    // Lightweight cleanup: fix header/footer zone violations caused by
    // orphans/widows or thead-repeat shifts without re-applying complex rules.
    applyMarginZoneCleanup(rootLayout);

    // Free Yoga nodes to prevent memory leaks
    rootYogaNode.freeRecursive();

    return {
      rootNode: rootLayout,
      pageRules: styleResolver.getPageRules(),
      fontFaceRules: styleResolver.getFontFaceRules()
    };
  }
}
