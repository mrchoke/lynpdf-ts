/**
 * Unit Tests: LayoutEngine (integration-level)
 */
import { describe, expect, test } from 'bun:test'
import { LayoutEngine } from '../../src/layout/layout-engine'
import { CSSParser } from '../../src/parser/css-parser'
import { HTMLParser } from '../../src/parser/html-parser'

function layout(html: string, css: string = '') {
  const dom = HTMLParser.parse(html)
  const ast = CSSParser.parse(css)
  return LayoutEngine.calculate(dom, ast)
}

describe('LayoutEngine', () => {
  test('calculate returns a LayoutResult', () => {
    const result = layout('<p>Hello</p>')
    expect(result).toBeDefined()
    expect(result.rootNode).toBeDefined()
    expect(result.pageRules).toBeDefined()
  })

  test('root node is type "document"', () => {
    const result = layout('<p>Hello</p>')
    expect(result.rootNode.type).toBe('document')
  })

  test('root node has positive dimensions', () => {
    const result = layout('<p>Hello World</p>')
    expect(result.rootNode.width).toBeGreaterThan(0)
    expect(result.rootNode.height).toBeGreaterThan(0)
  })

  test('root node has children', () => {
    const result = layout('<div><p>Hello</p></div>')
    expect(result.rootNode.children.length).toBeGreaterThan(0)
  })

  test('text nodes have content', () => {
    const result = layout('<p>สวัสดี</p>')
    const findTextNodes = (node: any): any[] => {
      const texts: any[] = []
      if (node.type === 'text' && node.content) texts.push(node)
      if (node.children) {
        for (const child of node.children) {
          texts.push(...findTextNodes(child))
        }
      }
      return texts
    }
    const textNodes = findTextNodes(result.rootNode)
    expect(textNodes.length).toBeGreaterThan(0)
    expect(textNodes[0].content).toBe('สวัสดี')
  })

  test('element nodes have x, y, width, height', () => {
    const result = layout('<div style="width: 200px; height: 100px;"><p>Hi</p></div>')
    const findBlock = (node: any): any => {
      if (node.type === 'block' && node.tagName === 'div') return node
      if (node.children) {
        for (const child of node.children) {
          const found = findBlock(child)
          if (found) return found
        }
      }
      return null
    }
    const div = findBlock(result.rootNode)
    expect(div).toBeDefined()
    expect(typeof div.x).toBe('number')
    expect(typeof div.y).toBe('number')
    expect(div.width).toBeGreaterThan(0)
    expect(div.height).toBeGreaterThan(0)
  })

  test('CSS styles are applied to layout', () => {
    const result = layout(
      '<div class="box"><p>Content</p></div>',
      '.box { padding: 20px; background-color: red; }'
    )
    const findBlock = (node: any): any => {
      if (node.type === 'block' && node.styles?.['background-color'] === 'red') return node
      if (node.children) {
        for (const child of node.children) {
          const found = findBlock(child)
          if (found) return found
        }
      }
      return null
    }
    const box = findBlock(result.rootNode)
    expect(box).toBeDefined()
  })

  test('flexbox row layout creates horizontal arrangement', () => {
    const result = layout(`
      <div style="display: flex; flex-direction: row;">
        <div style="width: 100px;"><p>A</p></div>
        <div style="width: 100px;"><p>B</p></div>
      </div>
    `)
    // Find the flex container's children
    const findFlexChildren = (node: any): any[] => {
      if (node.children?.length >= 2) {
        const c = node.children.filter((ch: any) => ch.type === 'block')
        if (c.length >= 2 && c[1].x > c[0].x) return c
      }
      for (const child of (node.children || [])) {
        const found = findFlexChildren(child)
        if (found.length >= 2) return found
      }
      return []
    }
    const children = findFlexChildren(result.rootNode)
    expect(children.length).toBeGreaterThanOrEqual(2)
    // Second child should be to the right of first
    expect(children[1].x).toBeGreaterThan(children[0].x)
  })

  test('handles table elements', () => {
    const result = layout(`
      <table>
        <tr><td>A</td><td>B</td></tr>
        <tr><td>C</td><td>D</td></tr>
      </table>
    `)
    expect(result.rootNode.height).toBeGreaterThan(0)
  })

  test('handles multiple elements', () => {
    const result = layout(`
      <h1>Title</h1>
      <p>Paragraph 1</p>
      <p>Paragraph 2</p>
      <div><p>Nested</p></div>
    `)
    expect(result.rootNode.children.length).toBeGreaterThan(0)
    expect(result.rootNode.height).toBeGreaterThan(0)
  })

  test('page rules are extracted from @page', () => {
    const result = layout(
      '<p>Hello</p>',
      '@page { size: A4; margin: 20mm; }'
    )
    expect(result.pageRules.length).toBeGreaterThanOrEqual(1)
  })

  test('handles Thai text layout', () => {
    const result = layout('<p>ประเทศไทยเป็นประเทศที่สวยงาม มีวัฒนธรรมอันเก่าแก่</p>')
    const findTextNodes = (node: any): any[] => {
      const texts: any[] = []
      if (node.type === 'text') texts.push(node)
      if (node.children) {
        for (const child of node.children) {
          texts.push(...findTextNodes(child))
        }
      }
      return texts
    }
    const textNodes = findTextNodes(result.rootNode)
    expect(textNodes.length).toBeGreaterThan(0)
  })
})
