/**
 * Unit Tests: HTML Parser
 */
import { describe, expect, test } from 'bun:test'
import { HTMLParser } from '../../src/parser/html-parser'

describe('HTMLParser', () => {
  test('parse returns a document node', () => {
    const doc = HTMLParser.parse('<html><body><p>Hello</p></body></html>')
    expect(doc).toBeDefined()
    expect(doc.nodeName).toBe('#document')
  })

  test('parse handles minimal HTML', () => {
    const doc = HTMLParser.parse('<p>Test</p>')
    expect(doc).toBeDefined()
    expect(doc.childNodes.length).toBeGreaterThan(0)
  })

  test('parse preserves text content', () => {
    const doc = HTMLParser.parse('<div>สวัสดี</div>')
    // Walk to find the text node
    const findText = (node: any): string | null => {
      if (node.nodeName === '#text') return node.value
      if (node.childNodes) {
        for (const child of node.childNodes) {
          const found = findText(child)
          if (found) return found
        }
      }
      return null
    }
    expect(findText(doc)).toBe('สวัสดี')
  })

  test('parse preserves attributes', () => {
    const doc = HTMLParser.parse('<div id="main" class="container"><p>Hi</p></div>')
    const findDiv = (node: any): any => {
      if (node.nodeName === 'div') return node
      if (node.childNodes) {
        for (const child of node.childNodes) {
          const found = findDiv(child)
          if (found) return found
        }
      }
      return null
    }
    const div = findDiv(doc)
    expect(div).toBeDefined()
    const attrs = div.attrs as Array<{ name: string; value: string }>
    expect(attrs.find((a: any) => a.name === 'id')?.value).toBe('main')
    expect(attrs.find((a: any) => a.name === 'class')?.value).toBe('container')
  })

  test('parse handles nested elements', () => {
    const doc = HTMLParser.parse('<div><ul><li>A</li><li>B</li></ul></div>')
    const findTag = (node: any, tag: string): any[] => {
      const results: any[] = []
      if (node.nodeName === tag) results.push(node)
      if (node.childNodes) {
        for (const child of node.childNodes) {
          results.push(...findTag(child, tag))
        }
      }
      return results
    }
    const lis = findTag(doc, 'li')
    expect(lis.length).toBe(2)
  })

  test('parse handles empty input', () => {
    const doc = HTMLParser.parse('')
    expect(doc).toBeDefined()
    expect(doc.nodeName).toBe('#document')
  })

  test('parse handles <style> blocks', () => {
    const doc = HTMLParser.parse('<html><head><style>body { color: red; }</style></head><body></body></html>')
    const findTag = (node: any, tag: string): any[] => {
      const results: any[] = []
      if (node.nodeName === tag) results.push(node)
      if (node.childNodes) {
        for (const child of node.childNodes) {
          results.push(...findTag(child, tag))
        }
      }
      return results
    }
    const styles = findTag(doc, 'style')
    expect(styles.length).toBe(1)
  })

  test('parse handles Thai content with special characters', () => {
    const doc = HTMLParser.parse('<p>น้ำ ผู้ ป่า ที่ ฎีกา</p>')
    const findText = (node: any): string | null => {
      if (node.nodeName === '#text' && node.value?.trim()) return node.value
      if (node.childNodes) {
        for (const child of node.childNodes) {
          const found = findText(child)
          if (found) return found
        }
      }
      return null
    }
    expect(findText(doc)).toBe('น้ำ ผู้ ป่า ที่ ฎีกา')
  })
})
