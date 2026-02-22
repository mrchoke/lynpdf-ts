/**
 * Unit Tests: CSS Parser
 */
import { describe, expect, test } from 'bun:test'
import * as cssTree from 'css-tree'
import { CSSParser } from '../../src/parser/css-parser'

describe('CSSParser', () => {
  test('parse returns a valid AST', () => {
    const ast = CSSParser.parse('body { color: red; }')
    expect(ast).toBeDefined()
    expect(ast.type).toBe('StyleSheet')
  })

  test('parse handles multiple rules', () => {
    const ast = CSSParser.parse(`
      h1 { font-size: 24px; color: blue; }
      p { margin: 10px; }
      .container { display: flex; }
    `)
    const rules: any[] = []
    cssTree.walk(ast, {
      visit: 'Rule',
      enter(node: any) {
        rules.push(node)
      },
    })
    expect(rules.length).toBe(3)
  })

  test('parse extracts declarations correctly', () => {
    const ast = CSSParser.parse('div { background-color: #ff0000; font-size: 16px; }')
    const declarations: Array<{ property: string; value: string }> = []
    cssTree.walk(ast, {
      visit: 'Declaration',
      enter(node: any) {
        declarations.push({
          property: node.property,
          value: cssTree.generate(node.value),
        })
      },
    })
    expect(declarations.find((d) => d.property === 'background-color')?.value).toBe('#ff0000')
    expect(declarations.find((d) => d.property === 'font-size')?.value).toBe('16px')
  })

  test('parse handles @page rules', () => {
    const ast = CSSParser.parse(`
      @page { size: A4; margin: 20mm; }
      @page :first { margin-top: 30mm; }
    `)
    const atRules: any[] = []
    cssTree.walk(ast, {
      visit: 'Atrule',
      enter(node: any) {
        if (node.name === 'page') atRules.push(node)
      },
    })
    expect(atRules.length).toBe(2)
  })

  test('parse handles complex selectors', () => {
    const ast = CSSParser.parse(`
      div.container > p.text { color: green; }
      #main .header h1 { font-size: 32px; }
      table th, table td { padding: 8px; }
    `)
    const rules: any[] = []
    cssTree.walk(ast, {
      visit: 'Rule',
      enter(node: any) {
        rules.push(node)
      },
    })
    // comma-separated selectors create 1 rule node with a SelectorList
    expect(rules.length).toBe(3)
  })

  test('parse handles empty CSS', () => {
    const ast = CSSParser.parse('')
    expect(ast).toBeDefined()
    expect(ast.type).toBe('StyleSheet')
  })

  test('parse handles CSS with Thai comments', () => {
    const ast = CSSParser.parse(`
      /* สไตล์สำหรับภาษาไทย */
      body { font-family: 'Sarabun', sans-serif; }
    `)
    const declarations: any[] = []
    cssTree.walk(ast, {
      visit: 'Declaration',
      enter(node: any) {
        declarations.push(node)
      },
    })
    expect(declarations.length).toBe(1)
    expect(declarations[0].property).toBe('font-family')
  })

  test('parse handles shorthand properties', () => {
    const ast = CSSParser.parse('div { margin: 10px 20px 30px 40px; padding: 5px; }')
    const declarations: Array<{ property: string; value: string }> = []
    cssTree.walk(ast, {
      visit: 'Declaration',
      enter(node: any) {
        declarations.push({
          property: node.property,
          value: cssTree.generate(node.value),
        })
      },
    })
    expect(declarations.find((d) => d.property === 'margin')?.value).toBe('10px 20px 30px 40px')
    expect(declarations.find((d) => d.property === 'padding')?.value).toBe('5px')
  })

  test('parse handles rgb/rgba colors', () => {
    const ast = CSSParser.parse('p { color: rgb(255, 0, 0); background: rgba(0, 0, 0, 0.5); }')
    const declarations: Array<{ property: string; value: string }> = []
    cssTree.walk(ast, {
      visit: 'Declaration',
      enter(node: any) {
        declarations.push({
          property: node.property,
          value: cssTree.generate(node.value),
        })
      },
    })
    expect(declarations.length).toBe(2)
  })
})
