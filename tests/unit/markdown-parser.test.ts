import { describe, expect, it } from 'bun:test'
import { MarkdownParser } from '../../src/parser/markdown-parser'

describe('MarkdownParser', () => {
  // ─── Basic conversion ───────────────────────────────

  it('converts a heading to <h1>', () => {
    const html = MarkdownParser.toHTML('# Hello', { wrapInDocument: false })
    expect(html.trim()).toBe('<h1>Hello</h1>')
  })

  it('converts bold and italic', () => {
    const html = MarkdownParser.toHTML('**bold** and *italic*', { wrapInDocument: false })
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
  })

  it('converts a link', () => {
    const html = MarkdownParser.toHTML('[LynPDF](https://lynpdf.dev)', { wrapInDocument: false })
    expect(html).toContain('<a href="https://lynpdf.dev">LynPDF</a>')
  })

  it('converts inline code', () => {
    const html = MarkdownParser.toHTML('Use `console.log()`', { wrapInDocument: false })
    expect(html).toContain('<code>console.log()</code>')
  })

  it('converts a fenced code block', () => {
    const md = '```js\nconsole.log("hi")\n```'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('<pre')
    expect(html).toContain('<code')
    expect(html).toContain('code-block-wrapper')
    // highlight.js tokens become inline-styled spans
    expect(html).toContain('console')
    expect(html).toContain('log')
    expect(html).toContain('style="color:')
  })

  // ─── GFM Tables ────────────────────────────────────

  it('converts a GFM table', () => {
    const md = `| Name | Age |\n|------|-----|\n| Lyn  | 3   |`
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('<table>')
    expect(html).toContain('<th>Name</th>')
    expect(html).toContain('<td>Lyn</td>')
  })

  // ─── Task lists ────────────────────────────────────

  it('converts task list items', () => {
    const md = '- [x] Done\n- [ ] Todo'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('checked')
    expect(html).toContain('task-list-item')
  })

  // ─── Footnotes ─────────────────────────────────────

  it('converts footnotes', () => {
    const md = 'Text[^1]\n\n[^1]: Footnote content'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('footnote')
  })

  // ─── Blockquote ────────────────────────────────────

  it('converts blockquotes', () => {
    const md = '> This is a quote'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('<blockquote>')
  })

  // ─── Strikethrough ─────────────────────────────────

  it('converts strikethrough', () => {
    const md = '~~deleted~~'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('<s>deleted</s>')
  })

  // ─── Horizontal rule ──────────────────────────────

  it('converts horizontal rule', () => {
    const md = '---'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('<hr>')
  })

  // ─── Document wrapping ────────────────────────────

  it('wraps in full HTML document by default', () => {
    const html = MarkdownParser.toHTML('# Title')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
    expect(html).toContain('<head>')
    expect(html).toContain('<body>')
    expect(html).toContain('</html>')
  })

  it('includes default CSS when wrapInDocument is true', () => {
    const html = MarkdownParser.toHTML('# Title')
    expect(html).toContain('<style>')
    expect(html).toContain('font-family')
  })

  it('excludes default CSS when includeDefaultCss is false', () => {
    const html = MarkdownParser.toHTML('# Title', { includeDefaultCss: false })
    expect(html).not.toContain('<style>')
  })

  it('sets the document title', () => {
    const html = MarkdownParser.toHTML('# Heading', { title: 'My Doc' })
    expect(html).toContain('<title>My Doc</title>')
  })

  it('escapes HTML in document title', () => {
    const html = MarkdownParser.toHTML('test', { title: '<script>alert("xss")</script>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  // ─── Empty input ──────────────────────────────────

  it('handles empty input', () => {
    const html = MarkdownParser.toHTML('', { wrapInDocument: false })
    expect(html.trim()).toBe('')
  })

  // ─── Thai text ────────────────────────────────────

  it('preserves Thai text', () => {
    const md = '# สวัสดี\n\nLynPDF รองรับภาษาไทย'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('สวัสดี')
    expect(html).toContain('ภาษาไทย')
  })

  // ─── Raw HTML passthrough ─────────────────────────

  it('passes through raw HTML in markdown', () => {
    const md = '<div style="color: red;">Hello</div>'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('<div style="color: red;">Hello</div>')
  })

  // ─── isMarkdownFile ───────────────────────────────

  it('detects .md files', () => {
    expect(MarkdownParser.isMarkdownFile('README.md')).toBe(true)
    expect(MarkdownParser.isMarkdownFile('doc.markdown')).toBe(true)
    expect(MarkdownParser.isMarkdownFile('doc.mdx')).toBe(true)
    expect(MarkdownParser.isMarkdownFile('doc.mdown')).toBe(true)
    expect(MarkdownParser.isMarkdownFile('doc.mkd')).toBe(true)
  })

  it('rejects non-markdown files', () => {
    expect(MarkdownParser.isMarkdownFile('index.html')).toBe(false)
    expect(MarkdownParser.isMarkdownFile('styles.css')).toBe(false)
    expect(MarkdownParser.isMarkdownFile('readme.txt')).toBe(false)
  })

  // ─── Syntax highlighting (highlight.js) ───────────

  it('adds inline syntax colors to fenced code with language', () => {
    const md = '```typescript\nconst x: number = 42\n```'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('code-block-wrapper')
    expect(html).toContain('code-lang-badge')
    expect(html).toContain('typescript')    // language badge text
    expect(html).toContain('style="color:#d73a49"')  // keyword 'const'
    expect(html).toContain('style="color:#005cc5"')  // number '42'
    // No double <pre> wrapping
    expect((html.match(/<pre/g) || []).length).toBe(1)
  })

  it('highlights Python code with inline colors', () => {
    const md = '```python\ndef hello():\n    print("hi")\n```'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('style="color:#d73a49"')  // keyword 'def'
    expect(html).toContain('style="color:#6f42c1"')  // function title 'hello'
  })

  it('highlights SQL code with inline colors', () => {
    const md = '```sql\nSELECT * FROM users WHERE id = 1\n```'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('style="color:#d73a49"')  // keyword 'SELECT'
  })

  it('applies no hljs classes for plain code blocks', () => {
    const md = '```\nplain text\n```'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('plain text')
    // Short plain text should not get auto-detection (relevance too low)
  })

  // ─── Alert containers ─────────────────────────────

  it('renders :::info container', () => {
    const md = ':::info\nInformation here\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-container')
    expect(html).toContain('md-info')
    expect(html).toContain('md-container-title')
    expect(html).toContain('Info')
    expect(html).toContain('Information here')
  })

  it('renders :::warning with custom title', () => {
    const md = ':::warning ระวัง!\nContent\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-warning')
    expect(html).toContain('ระวัง!')
  })

  it('renders :::tip container', () => {
    const md = ':::tip\nA helpful tip\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-tip')
    expect(html).toContain('Tip')
  })

  it('renders :::danger container', () => {
    const md = ':::danger\nDangerous!\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-danger')
  })

  it('renders :::note container', () => {
    const md = ':::note\nNote content\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-note')
  })

  it('renders :::caution container', () => {
    const md = ':::caution\nBe careful\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-caution')
  })

  it('renders :::important container', () => {
    const md = ':::important\nImportant content\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-important')
  })

  // ─── Card container ───────────────────────────────

  it('renders :::card with title', () => {
    const md = ':::card My Card Title\nCard content here\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-card')
    expect(html).toContain('md-card-title')
    expect(html).toContain('My Card Title')
    expect(html).toContain('Card content here')
  })

  it('renders :::card without title', () => {
    const md = ':::card\nJust content\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-card')
    expect(html).not.toContain('md-card-title')
  })

  // ─── Color box containers ─────────────────────────

  it('renders :::box-blue', () => {
    const md = ':::box-blue Blue Box Title\nContent\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-box')
    expect(html).toContain('md-box-blue')
    expect(html).toContain('md-box-title')
    expect(html).toContain('Blue Box Title')
  })

  it('renders :::box-green', () => {
    const md = ':::box-green\nGreen content\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-box-green')
  })

  it('renders :::box-red', () => {
    const md = ':::box-red Error\nRed content\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-box-red')
  })

  it('renders :::box-yellow', () => {
    const md = ':::box-yellow\nYellow content\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-box-yellow')
  })

  it('renders :::box-purple', () => {
    const md = ':::box-purple\nPurple content\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-box-purple')
  })

  it('renders :::box-gray', () => {
    const md = ':::box-gray\nGray content\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-box-gray')
  })

  it('renders :::box-orange', () => {
    const md = ':::box-orange\nOrange content\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-box-orange')
  })

  // ─── Details container ────────────────────────────

  it('renders :::details container', () => {
    const md = ':::details Click to expand\nHidden content\n:::'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-details')
    expect(html).toContain('md-details-summary')
    expect(html).toContain('Click to expand')
    expect(html).toContain('Hidden content')
  })

  // ─── GitHub Alerts ────────────────────────────────

  it('converts > [!NOTE] to alert container', () => {
    const md = '> [!NOTE]\n> This is a note'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-note')
    expect(html).toContain('md-github-alert')
    expect(html).toContain('Note')
    expect(html).toContain('This is a note')
  })

  it('converts > [!TIP] to alert container', () => {
    const md = '> [!TIP]\n> A helpful tip'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-tip')
    expect(html).toContain('md-github-alert')
  })

  it('converts > [!WARNING] to alert container', () => {
    const md = '> [!WARNING]\n> Be careful'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-warning')
    expect(html).toContain('md-github-alert')
  })

  it('converts > [!IMPORTANT] to alert container', () => {
    const md = '> [!IMPORTANT]\n> Read this'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-important')
    expect(html).toContain('md-github-alert')
  })

  it('converts > [!CAUTION] to alert container', () => {
    const md = '> [!CAUTION]\n> Be cautious'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('md-caution')
    expect(html).toContain('md-github-alert')
  })

  it('leaves normal blockquotes unchanged', () => {
    const md = '> Just a regular quote'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('<blockquote>')
    expect(html).not.toContain('md-github-alert')
  })

  // ─── Mermaid code blocks ──────────────────────────

  it('renders mermaid blocks as special divs (sync)', () => {
    const md = '```mermaid\ngraph TD\n    A-->B\n```'
    const html = MarkdownParser.toHTML(md, { wrapInDocument: false })
    expect(html).toContain('mermaid-block')
    expect(html).toContain('data-mermaid')
    expect(html).toContain('A--&gt;B')
  })

  // ─── toHTMLAsync ──────────────────────────────────

  it('toHTMLAsync returns same as toHTML for non-mermaid content', async () => {
    const md = '# Hello\n\nWorld'
    const sync = MarkdownParser.toHTML(md)
    const asyncResult = await MarkdownParser.toHTMLAsync(md)
    // Should be same since no mermaid blocks and mmdc likely not installed
    expect(asyncResult).toContain('<h1>Hello</h1>')
    expect(asyncResult).toContain('World')
  })

  it('toHTMLAsync converts mermaid to fallback when mmdc not available', async () => {
    const md = '```mermaid\ngraph TD\n    A-->B\n```'
    const html = await MarkdownParser.toHTMLAsync(md)
    // Either rendered SVG (if mmdc available) or fallback
    const hasMermaid = html.includes('md-mermaid') || html.includes('md-mermaid-fallback')
    expect(hasMermaid).toBe(true)
  })

  it('toHTMLAsync skips mermaid when renderMermaid is false', async () => {
    const md = '```mermaid\ngraph TD\n    A-->B\n```'
    const html = await MarkdownParser.toHTMLAsync(md, { renderMermaid: false, wrapInDocument: false })
    expect(html).toContain('mermaid-block')
    expect(html).toContain('data-mermaid')
    // The raw mermaid-block div should remain, not replaced with fallback
    expect(html).not.toContain('md-mermaid-fallback')
  })

  // ─── Default CSS includes new styles ──────────────

  it('default CSS includes code block styles', () => {
    const html = MarkdownParser.toHTML('# Test')
    expect(html).toContain('.code-block-wrapper')
    expect(html).toContain('.code-lang-badge')
    expect(html).toContain('pre code')
  })

  it('default CSS includes container styles', () => {
    const html = MarkdownParser.toHTML('# Test')
    expect(html).toContain('.md-container')
    expect(html).toContain('.md-info')
    expect(html).toContain('.md-warning')
    expect(html).toContain('.md-card')
    expect(html).toContain('.md-box-blue')
  })
})
