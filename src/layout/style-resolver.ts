import type * as cssTree from 'css-tree';
import * as css from 'css-tree';

export interface StyleRule {
  selector: string;
  declarations: Record<string, string>;
}

export interface PageRule {
  selector: string; // e.g., '', ':first', ':left', ':right'
  declarations: Record<string, string>;
  marginBoxes: Record<string, Record<string, string>>; // e.g., 'top-center': { content: '...' }
}

/** Parsed @font-face rule */
export interface FontFaceRule {
  /** CSS font-family name (unquoted) */
  family: string;
  /** src URL or file path (from url(...)) */
  src: string;
  /** font-weight: 'normal' | 'bold' | numeric string */
  weight: string;
  /** font-style: 'normal' | 'italic' | 'oblique' */
  style: string;
}

export class StyleResolver {
  private rules: StyleRule[] = [];
  private pageRules: PageRule[] = [];
  private fontFaceRules: FontFaceRule[] = [];

  constructor(ast: cssTree.CssNode) {
    this.parseRules(ast);
  }

  private parseRules(ast: cssTree.CssNode) {
    css.walk(ast, {
      enter: (node: cssTree.CssNode) => {
        if (node.type === 'Rule') {
          const selector = css.generate(node.prelude);
          const declarations: Record<string, string> = {};

          if (node.block) {
            node.block.children.forEach((childNode) => {
              if (childNode.type === 'Declaration') {
                declarations[childNode.property] = css.generate(childNode.value);
              }
            });
          }

          this.rules.push({ selector, declarations });
        } else if (node.type === 'Atrule' && node.name === 'page') {
          const selector = node.prelude ? css.generate(node.prelude) : '';
          const declarations: Record<string, string> = {};
          const marginBoxes: Record<string, Record<string, string>> = {};

          if (node.block) {
            node.block.children.forEach((childNode) => {
              if (childNode.type === 'Declaration') {
                declarations[childNode.property] = css.generate(childNode.value);
              } else if (childNode.type === 'Atrule') {
                const boxName = childNode.name;
                const boxDeclarations: Record<string, string> = {};
                if (childNode.block) {
                  childNode.block.children.forEach((decl) => {
                    if (decl.type === 'Declaration') {
                      boxDeclarations[decl.property] = css.generate(decl.value);
                    }
                  });
                }
                marginBoxes[boxName] = boxDeclarations;
              }
            });
          }

          this.pageRules.push({ selector, declarations, marginBoxes });
        } else if (node.type === 'Atrule' && node.name === 'font-face') {
          // Parse @font-face rule
          const declarations: Record<string, string> = {};
          if (node.block) {
            node.block.children.forEach((childNode) => {
              if (childNode.type === 'Declaration') {
                declarations[childNode.property] = css.generate(childNode.value);
              }
            });
          }

          const family = (declarations['font-family'] || '').replace(/^['"]|['"]$/g, '').trim();
          const weight = declarations['font-weight'] || 'normal';
          const style = declarations['font-style'] || 'normal';

          // Extract URL from src: url('...')
          const srcRaw = declarations['src'] || '';
          const urlMatch = srcRaw.match(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/);
          const src = urlMatch ? urlMatch[1]! : '';

          if (family && src) {
            this.fontFaceRules.push({ family, src, weight, style });
          }
        }
      }
    });
  }

  public getPageRules(): PageRule[] {
    return this.pageRules;
  }

  public getFontFaceRules(): FontFaceRule[] {
    return this.fontFaceRules;
  }

  public resolve(
    tagName: string,
    classes: string[],
    id?: string,
    ancestors: Array<{ tagName: string; classes: string[]; id?: string }> = [],
  ): Record<string, string> {
    const currentEl = { tagName, classes, id };
    const fullChain = [...ancestors, currentEl];
    const styles: Record<string, string> = {};

    for (const rule of this.rules) {
      const selectors = rule.selector.split(',').map((s) => s.trim()).filter(Boolean);

      let match = false;
      for (const sel of selectors) {
        if (this.selectorMatchesChain(sel, fullChain)) {
          match = true;
          break;
        }
      }

      if (match) {
        Object.assign(styles, rule.declarations);
      }
    }

    return styles;
  }

  // ── Selector matching helpers ────────────────────────────────────────────────

  /** Split a compound selector string into (selector, combinator) pairs. */
  private parseSelectorParts(selector: string): Array<{ sel: string; comb: ' ' | '>' | null }> {
    const parts: Array<{ sel: string; comb: ' ' | '>' | null }> = [];
    let i = 0;

    while (i < selector.length) {
      // Skip leading whitespace
      while (i < selector.length && (selector[i] === ' ' || selector[i] === '\t')) i++;
      if (i >= selector.length) break;

      // Determine combinator for this part
      let comb: ' ' | '>' | null;
      if (parts.length === 0) {
        comb = null;
      } else if (selector[i] === '>') {
        comb = '>';
        i++;
        while (i < selector.length && (selector[i] === ' ' || selector[i] === '\t')) i++;
      } else {
        comb = ' ';
      }

      // Read the simple selector (stop at whitespace or '>')
      let sel = '';
      while (i < selector.length && selector[i] !== ' ' && selector[i] !== '\t' && selector[i] !== '>') {
        sel += selector[i++];
      }

      if (sel) parts.push({ sel, comb });
    }

    return parts;
  }

  /** Check whether a simple selector (tag, .class, #id, combos) matches one element. */
  private matchSimple(sel: string, el: { tagName: string; classes: string[]; id?: string }): boolean {
    if (sel === '*') return true;

    let remaining = sel;
    let requiredTag = '';
    const requiredClasses: string[] = [];
    let requiredId = '';

    // Optional leading tag name
    const tagMatch = remaining.match(/^[a-zA-Z][a-zA-Z0-9]*/);
    if (tagMatch) {
      requiredTag = tagMatch[0];
      remaining = remaining.substring(requiredTag.length);
    }

    // .class fragments
    const classFrags = remaining.match(/\.[a-zA-Z_-][a-zA-Z0-9_-]*/g) || [];
    for (const c of classFrags) requiredClasses.push(c.substring(1));

    // #id fragment
    const idFrag = remaining.match(/#([a-zA-Z_-][a-zA-Z0-9_-]*)/);
    if (idFrag) requiredId = idFrag[1] ?? '';

    if (!requiredTag && requiredClasses.length === 0 && !requiredId) return false;
    if (requiredTag && requiredTag !== el.tagName) return false;
    for (const cls of requiredClasses) {
      if (!el.classes.includes(cls)) return false;
    }
    if (requiredId && el.id !== requiredId) return false;

    return true;
  }

  /**
   * Match parts[0..partIdx] against ancestors[0..startAncestorIdx], respecting combinators.
   * parts[partIdx+1] has already been matched (it was the current element or was matched above).
   */
  private matchRemainingParts(
    parts: Array<{ sel: string; comb: ' ' | '>' | null }>,
    partIdx: number,
    ancestors: Array<{ tagName: string; classes: string[]; id?: string }>,
    startAncestorIdx: number,
  ): boolean {
    if (partIdx < 0) return true; // All parts matched

    const thisPart = parts[partIdx];
    const nextPart = parts[partIdx + 1]; // The part whose combinator tells us how thisPart relates to it
    if (!thisPart || !nextPart) return false;
    const combinator = nextPart.comb ?? ' '; // ' ' or '>'

    if (combinator === '>') {
      // Direct child: thisPart must match exactly startAncestorIdx
      if (startAncestorIdx < 0) return false;
      const anc = ancestors[startAncestorIdx];
      if (!anc || !this.matchSimple(thisPart.sel, anc)) return false;
      return this.matchRemainingParts(parts, partIdx - 1, ancestors, startAncestorIdx - 1);
    } else {
      // Descendant ' ': thisPart must match some ancestor at index ≤ startAncestorIdx
      for (let i = startAncestorIdx; i >= 0; i--) {
        const anc = ancestors[i];
        if (anc && this.matchSimple(thisPart.sel, anc)) {
          if (this.matchRemainingParts(parts, partIdx - 1, ancestors, i - 1)) {
            return true;
          }
        }
      }
      return false;
    }
  }

  private selectorMatchesChain(
    selector: string,
    fullChain: Array<{ tagName: string; classes: string[]; id?: string }>,
  ): boolean {
    if (!fullChain.length) return false;
    const currentEl = fullChain[fullChain.length - 1]!;
    const ancestors = fullChain.slice(0, -1);

    const parts = this.parseSelectorParts(selector);
    if (!parts.length) return false;

    // Last part must match the current element
    const lastPart = parts[parts.length - 1];
    if (!lastPart || !this.matchSimple(lastPart.sel, currentEl)) return false;
    if (parts.length === 1) return true;

    // Remaining parts must match ancestors
    return this.matchRemainingParts(parts, parts.length - 2, ancestors, ancestors.length - 1);
  }
}
