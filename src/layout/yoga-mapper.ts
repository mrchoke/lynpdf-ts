import type { Node } from 'yoga-layout';
import Yoga from 'yoga-layout';

/**
 * Default base font size used for rem and when no font-size context is available.
 */
const BASE_FONT_SIZE_PT = 12; // 16px = 12pt

export class YogaMapper {
  /**
   * Apply CSS styles to a Yoga node.
   * @param node Yoga node
   * @param styles Resolved CSS styles
   * @param fontSize Font-size in points for resolving em/rem values (default 12pt = 16px)
   */
  static applyStyles(node: Node, styles: Record<string, string>, fontSize?: number) {
    const fs = fontSize ?? this.resolveFontSize(styles['font-size']);

    // Position type
    if (styles['position'] === 'absolute' || styles['position'] === 'fixed') {
      node.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
    } else if (styles['position'] === 'relative') {
      node.setPositionType(Yoga.POSITION_TYPE_RELATIVE);
    }

    // Position offsets (top, right, bottom, left)
    if (styles['top']) {
      const val = this.parseCssValue(styles['top'], fs);
      if (val !== undefined) node.setPosition(Yoga.EDGE_TOP, val);
    }
    if (styles['right']) {
      const val = this.parseCssValue(styles['right'], fs);
      if (val !== undefined) node.setPosition(Yoga.EDGE_RIGHT, val);
    }
    if (styles['bottom']) {
      const val = this.parseCssValue(styles['bottom'], fs);
      if (val !== undefined) node.setPosition(Yoga.EDGE_BOTTOM, val);
    }
    if (styles['left']) {
      const val = this.parseCssValue(styles['left'], fs);
      if (val !== undefined) node.setPosition(Yoga.EDGE_LEFT, val);
    }

    // Display
    if (styles['display'] === 'flex') {
      node.setDisplay(Yoga.DISPLAY_FLEX);
      // In CSS, default flex-direction is row. In Yoga, it's column.
      // So if display is flex and flex-direction is not explicitly column, set it to row.
      if (styles['flex-direction'] !== 'column') {
        node.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
      }
    } else if (styles['display'] === 'none') {
      node.setDisplay(Yoga.DISPLAY_NONE);
    }

    // Flex Direction
    if (styles['flex-direction'] === 'row') {
      node.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    } else if (styles['flex-direction'] === 'column') {
      node.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    }

    // Flex Wrap
    if (styles['flex-wrap'] === 'wrap') {
      node.setFlexWrap(Yoga.WRAP_WRAP);
    } else if (styles['flex-wrap'] === 'nowrap') {
      node.setFlexWrap(Yoga.WRAP_NO_WRAP);
    } else if (styles['flex-wrap'] === 'wrap-reverse') {
      node.setFlexWrap(Yoga.WRAP_WRAP_REVERSE);
    }

    // Justify Content
    if (styles['justify-content'] === 'center') {
      node.setJustifyContent(Yoga.JUSTIFY_CENTER);
    } else if (styles['justify-content'] === 'space-between') {
      node.setJustifyContent(Yoga.JUSTIFY_SPACE_BETWEEN);
    } else if (styles['justify-content'] === 'space-around') {
      node.setJustifyContent(Yoga.JUSTIFY_SPACE_AROUND);
    } else if (styles['justify-content'] === 'flex-end') {
      node.setJustifyContent(Yoga.JUSTIFY_FLEX_END);
    }

    // Align Items
    if (styles['align-items'] === 'center') {
      node.setAlignItems(Yoga.ALIGN_CENTER);
    } else if (styles['align-items'] === 'flex-start') {
      node.setAlignItems(Yoga.ALIGN_FLEX_START);
    } else if (styles['align-items'] === 'flex-end') {
      node.setAlignItems(Yoga.ALIGN_FLEX_END);
    } else if (styles['align-items'] === 'stretch') {
      node.setAlignItems(Yoga.ALIGN_STRETCH);
    }
    // Default: Yoga uses ALIGN_STRETCH (matches CSS default).
    // Children stretch to the full cross-axis of their parent.

    // Flex
    if (styles['flex']) {
      const flexValue = parseFloat(styles['flex']);
      if (!isNaN(flexValue)) {
        node.setFlexGrow(flexValue);
        node.setFlexShrink(1);
        node.setFlexBasisAuto();
      }
    }

    if (styles['flex-grow']) {
      const val = parseFloat(styles['flex-grow']);
      if (!isNaN(val)) node.setFlexGrow(val);
    }

    if (styles['flex-shrink']) {
      const val = parseFloat(styles['flex-shrink']);
      if (!isNaN(val)) node.setFlexShrink(val);
    }

    if (styles['flex-basis']) {
      if (styles['flex-basis'] === 'auto') {
        node.setFlexBasisAuto();
      } else if (styles['flex-basis'].endsWith('%')) {
        node.setFlexBasisPercent(parseFloat(styles['flex-basis']));
      } else {
        const val = this.parseCssValue(styles['flex-basis'], fs);
        if (val !== undefined) node.setFlexBasis(val);
      }
    }

    // Width & Height
    if (styles['width']) {
      this.applyDimension(styles['width'], (val) => node.setWidth(val), (val) => node.setWidthPercent(val), fs);
    }
    if (styles['height']) {
      this.applyDimension(styles['height'], (val) => node.setHeight(val), (val) => node.setHeightPercent(val), fs);
    }
    if (styles['max-width']) {
      this.applyDimension(styles['max-width'], (val) => node.setMaxWidth(val), (val) => node.setMaxWidthPercent(val), fs);
    }
    if (styles['min-width']) {
      this.applyDimension(styles['min-width'], (val) => node.setMinWidth(val), (val) => node.setMinWidthPercent(val), fs);
    }
    if (styles['max-height']) {
      this.applyDimension(styles['max-height'], (val) => node.setMaxHeight(val), (val) => node.setMaxHeightPercent(val), fs);
    }
    if (styles['min-height']) {
      this.applyDimension(styles['min-height'], (val) => node.setMinHeight(val), (val) => node.setMinHeightPercent(val), fs);
    }

    // Margins
    if (styles['margin']) {
      const [top, right, bottom, left] = this.parseShorthandEdges(styles['margin'], fs);
      if (top !== undefined)    node.setMargin(Yoga.EDGE_TOP, top);
      if (right !== undefined)  node.setMargin(Yoga.EDGE_RIGHT, right);
      if (bottom !== undefined) node.setMargin(Yoga.EDGE_BOTTOM, bottom);
      if (left !== undefined)   node.setMargin(Yoga.EDGE_LEFT, left);
    }
    if (styles['margin-top']) {
      const val = this.parseCssValue(styles['margin-top'], fs);
      if (val !== undefined) node.setMargin(Yoga.EDGE_TOP, val);
    }
    if (styles['margin-bottom']) {
      const val = this.parseCssValue(styles['margin-bottom'], fs);
      if (val !== undefined) node.setMargin(Yoga.EDGE_BOTTOM, val);
    }
    if (styles['margin-left']) {
      const val = this.parseCssValue(styles['margin-left'], fs);
      if (val !== undefined) node.setMargin(Yoga.EDGE_LEFT, val);
    }
    if (styles['margin-right']) {
      const val = this.parseCssValue(styles['margin-right'], fs);
      if (val !== undefined) node.setMargin(Yoga.EDGE_RIGHT, val);
    }

    // Padding
    if (styles['padding']) {
      const [top, right, bottom, left] = this.parseShorthandEdges(styles['padding']);
      if (top !== undefined)    node.setPadding(Yoga.EDGE_TOP, top);
      if (right !== undefined)  node.setPadding(Yoga.EDGE_RIGHT, right);
      if (bottom !== undefined) node.setPadding(Yoga.EDGE_BOTTOM, bottom);
      if (left !== undefined)   node.setPadding(Yoga.EDGE_LEFT, left);
    }
    if (styles['padding-top']) {
      const val = this.parseCssValue(styles['padding-top'], fs);
      if (val !== undefined) node.setPadding(Yoga.EDGE_TOP, val);
    }
    if (styles['padding-bottom']) {
      const val = this.parseCssValue(styles['padding-bottom'], fs);
      if (val !== undefined) node.setPadding(Yoga.EDGE_BOTTOM, val);
    }
    if (styles['padding-left']) {
      const val = this.parseCssValue(styles['padding-left'], fs);
      if (val !== undefined) node.setPadding(Yoga.EDGE_LEFT, val);
    }
    if (styles['padding-right']) {
      const val = this.parseCssValue(styles['padding-right'], fs);
      if (val !== undefined) node.setPadding(Yoga.EDGE_RIGHT, val);
    }

    // Border widths — so Yoga accounts for border in box size calculations
    // Parse an individual border side shorthand: "1px solid #color" → width
    const parseBorderWidth = (val: string | undefined): number | undefined => {
      if (!val || val === 'none') return undefined;
      return this.parseCssValue(val.trim().split(/\s+/)[0] ?? '', fs);
    };

    if (styles['border-width']) {
      const [top, right, bottom, left] = this.parseShorthandEdges(styles['border-width'], fs);
      if (top !== undefined)    node.setBorder(Yoga.EDGE_TOP, top);
      if (right !== undefined)  node.setBorder(Yoga.EDGE_RIGHT, right);
      if (bottom !== undefined) node.setBorder(Yoga.EDGE_BOTTOM, bottom);
      if (left !== undefined)   node.setBorder(Yoga.EDGE_LEFT, left);
    }
    if (styles['border']) {
      const w = parseBorderWidth(styles['border']);
      if (w !== undefined) node.setBorder(Yoga.EDGE_ALL, w);
    }
    const borderSides: Array<[string, number]> = [
      ['border-top', Yoga.EDGE_TOP], ['border-right', Yoga.EDGE_RIGHT],
      ['border-bottom', Yoga.EDGE_BOTTOM], ['border-left', Yoga.EDGE_LEFT],
    ];
    for (const [prop, edge] of borderSides) {
      const w = parseBorderWidth(styles[prop]);
      if (w !== undefined) node.setBorder(edge, w);
    }
    for (const [prop, edge] of ([
      ['border-top-width', Yoga.EDGE_TOP], ['border-right-width', Yoga.EDGE_RIGHT],
      ['border-bottom-width', Yoga.EDGE_BOTTOM], ['border-left-width', Yoga.EDGE_LEFT],
    ] as Array<[string, number]>)) {
      const w = this.parseCssValue(styles[prop] ?? '', fs);
      if (w !== undefined) node.setBorder(edge, w);
    }

    // Border-collapse: skip shared (left/top) Yoga borders for non-first cells
    if (styles['border-collapse'] === 'collapse') {
      const cellIdx = parseInt(styles['_cellIndex'] ?? '-1', 10);
      const rowIdx = parseInt(styles['_rowIndex'] ?? '-1', 10);
      if (cellIdx > 0) {
        node.setBorder(Yoga.EDGE_LEFT, 0);
      }
      if (rowIdx > 0) {
        node.setBorder(Yoga.EDGE_TOP, 0);
      }
    }
  }

  private static applyDimension(value: string, setExact: (val: number) => void, setPercent: (val: number) => void, fontSize?: number) {
    if (value === 'auto') return;
    if (value.endsWith('%')) {
      setPercent(parseFloat(value));
    } else {
      const parsed = this.parseCssValue(value, fontSize);
      if (parsed !== undefined) setExact(parsed);
    }
  }

  /**
   * Resolve a bare font-size CSS value to points.
   * Used to derive context when no external font-size is provided.
   */
  private static resolveFontSize(raw: string | undefined): number {
    if (!raw) return BASE_FONT_SIZE_PT;
    const val = parseFloat(raw);
    if (isNaN(val)) return BASE_FONT_SIZE_PT;
    const trimmed = raw.trim();
    if (trimmed.endsWith('px')) return val * 0.75;
    if (trimmed.endsWith('pt')) return val;
    if (trimmed.endsWith('em') || trimmed.endsWith('rem')) return val * BASE_FONT_SIZE_PT;
    if (trimmed.endsWith('in')) return val * 72;
    if (trimmed.endsWith('cm')) return val * 28.3465;
    if (trimmed.endsWith('mm')) return val * 2.83465;
    // bare number: check if likely px (>= 8 and not fractional → px convention)
    return val >= 8 ? val * 0.75 : val;
  }

  /**
   * Parse a CSS value with unit to points.
   * Supports: px, pt, em, rem, in, cm, mm. Bare numbers treated as pt.
   */
  private static parseCssValue(value: string, fontSize?: number): number | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    const num = parseFloat(trimmed);
    if (isNaN(num)) return undefined;
    const fs = fontSize ?? BASE_FONT_SIZE_PT;

    if (trimmed.endsWith('px')) return num * 0.75;       // 1px = 0.75pt
    if (trimmed.endsWith('pt')) return num;               // already points
    if (trimmed.endsWith('em')) return num * fs;           // relative to font-size
    if (trimmed.endsWith('rem')) return num * BASE_FONT_SIZE_PT; // relative to root font
    if (trimmed.endsWith('in')) return num * 72;           // 1in = 72pt
    if (trimmed.endsWith('cm')) return num * 28.3465;      // 1cm ≈ 28.3465pt
    if (trimmed.endsWith('mm')) return num * 2.83465;      // 1mm ≈ 2.83465pt
    if (trimmed.endsWith('vw') || trimmed.endsWith('vh')) return num; // fallback
    // bare number — treat as points (PDFKit native unit)
    return num;
  }

  private static parseValue(value: string): number | undefined {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Parse a CSS box shorthand (margin/padding) into [top, right, bottom, left].
   * Follows CSS rules:
   *   1 value  → all edges equal
   *   2 values → top/bottom, left/right
   *   3 values → top, left/right, bottom
   *   4 values → top, right, bottom, left
   */
  private static parseShorthandEdges(value: string, fontSize?: number): [number | undefined, number | undefined, number | undefined, number | undefined] {
    const parts = value.trim().split(/\s+/).map(v => this.parseCssValue(v, fontSize));
    if (parts.length === 1) {
      const v = parts[0];
      return [v, v, v, v];
    } else if (parts.length === 2) {
      const [tb, lr] = parts;
      return [tb, lr, tb, lr];
    } else if (parts.length === 3) {
      const [top, lr, bottom] = parts;
      return [top, lr, bottom, lr];
    } else {
      return [parts[0], parts[1], parts[2], parts[3]];
    }
  }
}
