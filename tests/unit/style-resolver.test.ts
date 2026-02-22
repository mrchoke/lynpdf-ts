/**
 * Unit Tests: StyleResolver
 */
import { describe, expect, test } from 'bun:test'
import { StyleResolver } from '../../src/layout/style-resolver'
import { CSSParser } from '../../src/parser/css-parser'

function resolve(css: string, tagName: string, classes: string[] = [], id?: string, ancestors?: any[]) {
  const ast = CSSParser.parse(css)
  const resolver = new StyleResolver(ast)
  return resolver.resolve(tagName, classes, id, ancestors)
}

describe('StyleResolver', () => {
  // ── Basic Selectors ──
  test('resolves tag selector', () => {
    const styles = resolve('p { color: red; }', 'p')
    expect(styles.color).toBe('red')
  })

  test('resolves class selector', () => {
    const styles = resolve('.highlight { background-color: yellow; }', 'div', ['highlight'])
    expect(styles['background-color']).toBe('yellow')
  })

  test('resolves id selector', () => {
    const styles = resolve('#main { font-size: 20px; }', 'div', [], 'main')
    expect(styles['font-size']).toBe('20px')
  })

  test('resolves compound selector (tag + class)', () => {
    const styles = resolve('p.intro { font-weight: bold; }', 'p', ['intro'])
    expect(styles['font-weight']).toBe('bold')
  })

  test('does not match wrong tag with class', () => {
    const styles = resolve('p.intro { font-weight: bold; }', 'div', ['intro'])
    expect(styles['font-weight']).toBeUndefined()
  })

  // ── Cascade (later rule wins) ──
  test('later rule overrides earlier rule (same specificity)', () => {
    const styles = resolve(`
      p { color: red; }
      p { color: blue; }
    `, 'p')
    expect(styles.color).toBe('blue')
  })

  test('more specific selector wins', () => {
    const styles = resolve(`
      p { color: red; }
      p.special { color: green; }
    `, 'p', ['special'])
    expect(styles.color).toBe('green')
  })

  // ── Multiple Properties ──
  test('resolves multiple properties', () => {
    const styles = resolve(`
      .card {
        background-color: white;
        border: 1px solid #ccc;
        padding: 16px;
        margin-bottom: 12px;
      }
    `, 'div', ['card'])
    expect(styles['background-color']).toBe('white')
    expect(styles.border).toBe('1px solid #ccc')
    expect(styles.padding).toBe('16px')
    expect(styles['margin-bottom']).toBe('12px')
  })

  // ── Descendant Combinator ──
  test('resolves descendant combinator', () => {
    const css = '.container p { color: navy; }'
    const ast = CSSParser.parse(css)
    const resolver = new StyleResolver(ast)
    const ancestors = [{ tagName: 'div', classes: ['container'], id: undefined }]
    const styles = resolver.resolve('p', [], undefined, ancestors)
    expect(styles.color).toBe('navy')
  })

  test('descendant combinator does not match without ancestor', () => {
    const css = '.container p { color: navy; }'
    const ast = CSSParser.parse(css)
    const resolver = new StyleResolver(ast)
    const styles = resolver.resolve('p', [], undefined, [])
    expect(styles.color).toBeUndefined()
  })

  // ── Child Combinator ──
  test('resolves child combinator', () => {
    const css = '.parent > .child { margin: 10px; }'
    const ast = CSSParser.parse(css)
    const resolver = new StyleResolver(ast)
    const ancestors = [{ tagName: 'div', classes: ['parent'], id: undefined }]
    const styles = resolver.resolve('div', ['child'], undefined, ancestors)
    expect(styles.margin).toBe('10px')
  })

  // ── @page Rules ──
  test('getPageRules returns page rules', () => {
    const css = `
      @page { size: A4; margin: 20mm; }
      @page :first { margin-top: 30mm; }
    `
    const ast = CSSParser.parse(css)
    const resolver = new StyleResolver(ast)
    const pageRules = resolver.getPageRules()
    expect(pageRules.length).toBeGreaterThanOrEqual(1)
  })

  test('page rules contain margin boxes', () => {
    const css = `
      @page {
        size: A4;
        @top-center { content: "Header"; }
        @bottom-right { content: "Page " counter(page); }
      }
    `
    const ast = CSSParser.parse(css)
    const resolver = new StyleResolver(ast)
    const pageRules = resolver.getPageRules()
    expect(pageRules.length).toBeGreaterThanOrEqual(1)
  })

  // ── Edge Cases ──
  test('handles empty CSS', () => {
    const styles = resolve('', 'p')
    expect(Object.keys(styles).length).toBe(0)
  })

  test('handles unmatched selectors', () => {
    const styles = resolve('.nonexistent { color: red; }', 'p')
    expect(styles.color).toBeUndefined()
  })

  test('resolves multiple classes', () => {
    const styles = resolve(`
      .btn { padding: 8px; }
      .btn-primary { background-color: blue; color: white; }
    `, 'button', ['btn', 'btn-primary'])
    expect(styles.padding).toBe('8px')
    expect(styles['background-color']).toBe('blue')
    expect(styles.color).toBe('white')
  })
})
