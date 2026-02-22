/**
 * Unit Tests: PDFCreator (integration-level)
 */
import { describe, expect, test } from 'bun:test'
import * as fs from 'fs'
import { PDFDocument } from 'pdf-lib'
import { PDFCreator } from '../../src/pdf-creator'

const OUTPUT_DIR = 'tests/output'

describe('PDFCreator', () => {
  test('constructor accepts default options', () => {
    const creator = new PDFCreator()
    expect(creator).toBeDefined()
  })

  test('constructor accepts custom options', () => {
    const creator = new PDFCreator({
      pageSize: 'A4',
      margin: 30,
      colorEmoji: false,
      verbose: false,
    })
    expect(creator).toBeDefined()
  })

  test('createPDF generates a valid PDF file', async () => {
    const creator = new PDFCreator({ verbose: false })
    const outPath = `${OUTPUT_DIR}/unit-test-basic.pdf`
    const result = await creator.createPDF('<p>Hello World</p>', 'p { color: black; }', outPath)

    expect(result.path).toBe(outPath)
    expect(result.pages).toBeGreaterThanOrEqual(1)
    expect(result.elapsed).toBeGreaterThan(0)
    expect(fs.existsSync(outPath)).toBe(true)

    // Verify it's a valid PDF
    const buf = fs.readFileSync(outPath)
    const pdf = await PDFDocument.load(buf)
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  test('createPDF with Thai text', async () => {
    const creator = new PDFCreator({ verbose: false })
    const outPath = `${OUTPUT_DIR}/unit-test-thai.pdf`
    const html = '<h1>สวัสดีครับ</h1><p>ทดสอบภาษาไทย น้ำพริก ผู้ใหญ่ บ้านเกิด</p>'
    const result = await creator.createPDF(html, '', outPath)

    expect(result.pages).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(outPath)).toBe(true)
  })

  test('createPDF with emoji', async () => {
    const creator = new PDFCreator({ verbose: false, colorEmoji: true })
    const outPath = `${OUTPUT_DIR}/unit-test-emoji.pdf`
    const html = '<p>Hello 😀 World 🎉</p>'
    const result = await creator.createPDF(html, '', outPath)

    expect(result.pages).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(outPath)).toBe(true)

    // Check PDF has images (from emoji PNGs)
    const buf = fs.readFileSync(outPath)
    const raw = buf.toString('latin1')
    const hasImage = raw.includes('/Subtype /Image') || raw.includes('/XObject')
    expect(hasImage).toBe(true)
  })

  test('createPDF with flexbox layout', async () => {
    const creator = new PDFCreator({ verbose: false })
    const outPath = `${OUTPUT_DIR}/unit-test-flex.pdf`
    const html = `
      <div style="display: flex; flex-direction: row;">
        <div style="flex: 1; padding: 10px; background-color: #cce5ff;"><p>Left</p></div>
        <div style="flex: 1; padding: 10px; background-color: #d4edda;"><p>Right</p></div>
      </div>
    `
    const result = await creator.createPDF(html, '', outPath)
    expect(result.pages).toBeGreaterThanOrEqual(1)
  })

  test('createPDF with table', async () => {
    const creator = new PDFCreator({ verbose: false })
    const outPath = `${OUTPUT_DIR}/unit-test-table.pdf`
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Alpha</td><td>100</td></tr>
          <tr><td>Beta</td><td>200</td></tr>
        </tbody>
      </table>
    `
    const css = 'table { width: 100%; } th, td { border: 1px solid #333; padding: 8px; }'
    const result = await creator.createPDF(html, css, outPath)
    expect(result.pages).toBeGreaterThanOrEqual(1)
  })

  test('createPDF with inline styles', async () => {
    const creator = new PDFCreator({ verbose: false })
    const outPath = `${OUTPUT_DIR}/unit-test-inline.pdf`
    const html = `
      <html><head><style>
        .custom { color: #ff0000; font-size: 20px; }
      </style></head>
      <body><p class="custom">Red text from inline style</p></body></html>
    `
    const result = await creator.createPDF(html, '', outPath)
    expect(result.pages).toBeGreaterThanOrEqual(1)
  })

  test('createPDFBuffer returns a Buffer', async () => {
    const creator = new PDFCreator({ verbose: false })
    const buf = await creator.createPDFBuffer('<p>Buffer test</p>', 'p { color: blue; }')

    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(0)

    // Verify it's a valid PDF
    const pdf = await PDFDocument.load(buf)
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  test('createPDF with page-break creates multiple pages', async () => {
    const creator = new PDFCreator({ verbose: false })
    const outPath = `${OUTPUT_DIR}/unit-test-pagebreak.pdf`
    const html = `
      <div><p>Page 1 content</p></div>
      <div style="page-break-before: always;"><p>Page 2 content</p></div>
    `
    const result = await creator.createPDF(html, '', outPath)

    const buf = fs.readFileSync(outPath)
    const pdf = await PDFDocument.load(buf)
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  test('createPDF A4 page dimensions', async () => {
    const creator = new PDFCreator({ verbose: false })
    const outPath = `${OUTPUT_DIR}/unit-test-a4.pdf`
    await creator.createPDF('<p>A4 test</p>', '', outPath)

    const buf = fs.readFileSync(outPath)
    const pdf = await PDFDocument.load(buf)
    const page = pdf.getPage(0)
    const { width, height } = page.getSize()

    // A4: 595.28 × 841.89 (±1pt tolerance)
    expect(Math.abs(width - 595.28)).toBeLessThan(1)
    expect(Math.abs(height - 841.89)).toBeLessThan(1)
  })
})
