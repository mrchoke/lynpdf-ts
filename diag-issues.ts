import { LayoutEngine } from './src/layout/layout-engine'
import { CSSParser } from './src/parser/css-parser'
import { HTMLParser } from './src/parser/html-parser'
import { readFileSync } from 'fs'

const html = readFileSync('examples/book-lynpdf-guide.html', 'utf-8')
const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)
const css = styleMatch ? styleMatch.map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n') : ''
const dom = HTMLParser.parse(html)
const ast = CSSParser.parse(css)
const result = LayoutEngine.calculate(dom, ast)
const root = result.rootNode

const PAGE_H = result.pageHeight

function actualBottom(node: any): number {
  let maxB = node.y + node.height
  for (const c of node.children || []) maxB = Math.max(maxB, actualBottom(c))
  return maxB
}

function pageInfo(y: number) {
  const pg = Math.floor(y / PAGE_H)
  const local = y - pg * PAGE_H
  return { pg, local: local.toFixed(1) }
}

function getText(node: any, maxLen = 80): string {
  if (node.text) return node.text.substring(0, maxLen)
  let txt = ''
  for (const c of node.children || []) {
    txt += getText(c, maxLen - txt.length)
    if (txt.length >= maxLen) break
  }
  return txt.substring(0, maxLen)
}

function dumpTree(node: any, indent: string, maxDepth = 5) {
  if (maxDepth <= 0) return
  const tag = node.tagName || (node.text ? 'TEXT' : '?')
  const text = node.text ? ` "${node.text.substring(0, 50)}"` : ''
  const cls = node.className ? `.${node.className.replace(/\s+/g, '.')}` : ''
  const pi = pageInfo(node.y)
  console.log(`${indent}${tag}${cls} x=${node.x.toFixed(1)} y=${node.y.toFixed(1)} w=${node.width.toFixed(1)} h=${node.height.toFixed(1)} pg${pi.pg} local=${pi.local}${text}`)
  for (const c of node.children || []) dumpTree(c, indent + '  ', maxDepth - 1)
}

function findWithParent(node: any, pred: (n: any) => boolean, parent: any = null): Array<{node: any, parent: any}> {
  const results: Array<{node: any, parent: any}> = []
  if (pred(node)) results.push({ node, parent })
  for (const c of node.children || []) results.push(...findWithParent(c, pred, node))
  return results
}

// === 1. TOC div ===
console.log('=== TOC DIV ANALYSIS ===')
const body = root.children?.[0]
if (body) {
  console.log(`body: children=${body.children.length}`)
  for (let i = 0; i < Math.min(body.children.length, 10); i++) {
    const ch = body.children[i]
    const pi = pageInfo(ch.y)
    const tag = ch.tagName || 'TEXT'
    const cls = ch.className || ''
    const txt = getText(ch, 50)
    console.log(`  [${i}] ${tag}${cls ? '.' + cls : ''} y=${ch.y.toFixed(1)} h=${ch.height.toFixed(1)} w=${ch.width.toFixed(1)} pg${pi.pg} | ${txt}`)
    
    if (ch.y > 900 && ch.y < 1100 && ch.children?.length >= 10) {
      console.log('\n  --- TOC entries ---')
      for (let j = 0; j < ch.children.length; j++) {
        const p = ch.children[j]
        const pp = pageInfo(p.y)
        const ab = actualBottom(p)
        const overflow = ab - p.y - p.height
        console.log(`    [${j}] ${p.tagName} y=${p.y.toFixed(1)} h=${p.height.toFixed(1)} w=${p.width.toFixed(1)} actBot=${ab.toFixed(1)} overflow=${overflow.toFixed(1)} pg${pp.pg} | ${getText(p, 60)}`)
        if (j < 3) {
          dumpTree(p, '      ', 5)
        }
      }
    }
  }
}

// === 2. Note-box divs ===
console.log('\n=== NOTE-BOX DIVS ===')
const noteBoxes = findWithParent(root, n => n.className?.includes('note-box'))
for (const {node: nb} of noteBoxes) {
  const pi = pageInfo(nb.y)
  const ab = actualBottom(nb)
  const overflow = ab - nb.y - nb.height
  console.log(`note-box y=${nb.y.toFixed(1)} h=${nb.height.toFixed(1)} w=${nb.width.toFixed(1)} actBot=${ab.toFixed(1)} overflow=${overflow.toFixed(1)} pg${pi.pg} local=${pi.local}`)
  dumpTree(nb, '  ', 4)
  console.log()
}

// === 3. Significant overflows (> 20pt) ===
console.log('\n=== SIGNIFICANT OVERFLOWS (> 20pt) ===')
const allOverflows = findWithParent(root, n => {
  if (!n.tagName || n.tagName === 'body' || n.tagName === 'table' || n.tagName === 'tbody' || n.tagName === 'thead') return false
  const nom = n.y + n.height
  const act = actualBottom(n)
  return act > nom + 20
})
for (const {node: ov} of allOverflows) {
  const nom = ov.y + ov.height
  const act = actualBottom(ov)
  const pi = pageInfo(ov.y)
  const cls = ov.className || ''
  const tag = ov.tagName || '?'
  console.log(`${tag}${cls ? '.' + cls : ''} y=${ov.y.toFixed(1)} h=${ov.height.toFixed(1)} nomBot=${nom.toFixed(1)} actBot=${act.toFixed(1)} overflow=${(act-nom).toFixed(1)}pt pg${pi.pg} local=${pi.local} | ${getText(ov, 40)}`)
}
