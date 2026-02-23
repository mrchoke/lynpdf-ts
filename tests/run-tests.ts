/**
 * LynPDF Test Suite — Runner & Assertion Framework
 *
 * Generates PDFs from test fixtures and validates them using pdf-lib inspection.
 * Run: bun run tests/run-tests.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument } from 'pdf-lib'
import { PDFCreator } from '../src/pdf-creator'

// ─── Types ───────────────────────────────────────────────────
interface TestCase {
  id: string
  name: string
  htmlFile: string
  /** Expected minimum page count */
  minPages?: number
  /** Expected maximum page count */
  maxPages?: number
  /** Expected exact page count (overrides min/max) */
  pages?: number
  /** Custom assertions on the generated PDF buffer */
  assertions?: (pdf: PDFDocument, buf: Buffer) => Promise<AssertionResult[]>
  /** Mark as known-unimplemented feature (skipped from fail count) */
  unimplemented?: boolean
}

interface AssertionResult {
  label: string
  passed: boolean
  detail?: string
}

interface TestResult {
  id: string
  name: string
  passed: boolean
  skipped: boolean
  duration: number
  pdfPath: string
  pages: number
  assertions: AssertionResult[]
  error?: string
}

// ─── Colors ──────────────────────────────────────────────────
const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

// ─── Assertion Helpers ───────────────────────────────────────

/** Check that PDF text content contains a specific string */
async function assertPdfContainsText (buf: Buffer, needle: string): Promise<AssertionResult> {
  // Simple heuristic: look for the string in the raw PDF bytes
  const raw = buf.toString('latin1')
  const found = raw.includes(needle)
  return {
    label: `PDF contains text "${needle}"`,
    passed: found,
    detail: found ? undefined : `Text not found in PDF stream`,
  }
}

/** Check file size is within range */
function assertFileSize (buf: Buffer, minKB: number, maxKB: number): AssertionResult {
  const kb = buf.length / 1024
  const ok = kb >= minKB && kb <= maxKB
  return {
    label: `File size ${kb.toFixed(0)}KB within ${minKB}–${maxKB}KB`,
    passed: ok,
    detail: ok ? undefined : `Actual: ${kb.toFixed(1)}KB`,
  }
}

/** Check page dimensions match expected (A4: 595.28 × 841.89) */
function assertPageSize (pdf: PDFDocument, expectedW: number, expectedH: number, tolerance = 1): AssertionResult {
  const page = pdf.getPage(0)
  const { width, height } = page.getSize()
  const wOk = Math.abs(width - expectedW) <= tolerance
  const hOk = Math.abs(height - expectedH) <= tolerance
  return {
    label: `Page size ${width.toFixed(1)}×${height.toFixed(1)} ≈ ${expectedW}×${expectedH}`,
    passed: wOk && hOk,
    detail: wOk && hOk ? undefined : `Actual: ${width.toFixed(2)}×${height.toFixed(2)}`,
  }
}

/** Check page count */
function assertPageCount (pdf: PDFDocument, expected: number): AssertionResult {
  const actual = pdf.getPageCount()
  return {
    label: `Page count: ${actual} === ${expected}`,
    passed: actual === expected,
    detail: actual === expected ? undefined : `Expected ${expected}, got ${actual}`,
  }
}

/** Check page count is in range [min, max] */
function assertPageCountRange (pdf: PDFDocument, min: number, max: number): AssertionResult {
  const actual = pdf.getPageCount()
  const ok = actual >= min && actual <= max
  return {
    label: `Page count: ${actual} in [${min}, ${max}]`,
    passed: ok,
    detail: ok ? undefined : `Expected ${min}–${max}, got ${actual}`,
  }
}

/** Check that PDF has embedded fonts */
async function assertHasEmbeddedFonts (buf: Buffer): Promise<AssertionResult> {
  const raw = buf.toString('latin1')
  const hasFont = raw.includes('/Type /Font') || raw.includes('/FontDescriptor')
  return {
    label: `PDF has embedded fonts`,
    passed: hasFont,
  }
}

/** Check that PDF has images (for emoji or img tests) */
async function assertHasImages (buf: Buffer): Promise<AssertionResult> {
  const raw = buf.toString('latin1')
  const hasImage = raw.includes('/Subtype /Image') || raw.includes('/XObject')
  return {
    label: `PDF has embedded images`,
    passed: hasImage,
  }
}

// ─── Test Cases Definition ───────────────────────────────────
// Custom config / assertions for known fixtures.  Keyed by filename.

const TEST_CASE_CONFIG: Record<string, Partial<TestCase>> = {
  'test-01-thai-typography.html': {
    name: 'สระลอยและวรรณยุกต์ซ้อน (Glyph Positioning)',
    minPages: 1, maxPages: 5,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      await assertHasEmbeddedFonts(buf),
      assertFileSize(buf, 5, 500),
    ],
  },
  'test-02-paged-media.html': {
    name: 'Page Size & Margins',
    minPages: 3, maxPages: 6,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      assertPageCountRange(pdf, 3, 6),
    ],
  },
  'test-03-tables.html': {
    name: 'ตารางยาว, colspan, border-collapse',
    minPages: 2, maxPages: 8,
    assertions: async (pdf, buf) => [
      assertPageCountRange(pdf, 2, 8),
      assertFileSize(buf, 5, 500),
    ],
  },
  'test-04-box-model.html': {
    name: 'Flexbox, Position, Overflow, Box Model',
    minPages: 1, maxPages: 4,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      assertFileSize(buf, 5, 500),
    ],
  },
  'test-05-graphics-colors.html': {
    name: 'RGBA, Images, Borders, Emoji',
    minPages: 1, maxPages: 4,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      await assertHasImages(buf),
      assertFileSize(buf, 10, 2000),
    ],
  },
  'test-06-links-metadata.html': {
    name: 'Internal/External Links',
    minPages: 3, maxPages: 6,
    assertions: async (pdf, buf) => [
      assertPageCountRange(pdf, 3, 6),
      await assertHasEmbeddedFonts(buf),
    ],
  },
  'test-07-certificate.html': {
    name: 'ใบประกาศนียบัตร (Thai Certificate)',
    minPages: 1, maxPages: 3,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      await assertHasEmbeddedFonts(buf),
      assertFileSize(buf, 5, 500),
    ],
  },
  'test-08-thead-repeat.html': {
    name: 'หัวตารางซ้ำทุกหน้า (Thead Repeat)',
    minPages: 3, maxPages: 18,
    assertions: async (pdf, buf) => [
      assertPageCountRange(pdf, 3, 18),
      await assertHasEmbeddedFonts(buf),
      assertFileSize(buf, 10, 500),
    ],
  },
  'test-09-kerning-ligature.html': {
    name: 'Kerning, Ligature, Thai Glyph (Font Quality)',
    minPages: 2, maxPages: 15,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      await assertHasEmbeddedFonts(buf),
      assertFileSize(buf, 5, 1000),
    ],
  },
  'test-10-otf-font.html': {
    name: 'OTF Font — IBM Plex Sans',
    minPages: 1, maxPages: 5,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      await assertHasEmbeddedFonts(buf),
      assertFileSize(buf, 5, 1000),
    ],
  },
  'test-11-variable-font.html': {
    name: 'Variable Font — Inter Variable (TTF/OTF+Variable)',
    minPages: 1, maxPages: 6,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      await assertHasEmbeddedFonts(buf),
      assertFileSize(buf, 5, 2000),
    ],
  },
  'test-12-metadata.html': {
    name: 'PDF Metadata จาก HTML <meta>',
    minPages: 1, maxPages: 3,
    assertions: async (pdf, buf) => {
      const results: AssertionResult[] = [
        assertPageSize(pdf, 595.28, 841.89),
        await assertHasEmbeddedFonts(buf),
      ]
      const title = pdf.getTitle()
      results.push({
        label: `PDF Title = "${title}"`,
        passed: title === 'LynPDF Metadata Test Document',
        detail: title !== 'LynPDF Metadata Test Document' ? `Got: "${title}"` : undefined,
      })
      const author = pdf.getAuthor()
      results.push({
        label: `PDF Author = "${author}"`,
        passed: author === 'LynPDF Test Suite',
        detail: author !== 'LynPDF Test Suite' ? `Got: "${author}"` : undefined,
      })
      const subject = pdf.getSubject()
      results.push({
        label: `PDF Subject is set`,
        passed: !!subject && subject.length > 0,
        detail: !subject ? 'Subject is empty' : undefined,
      })
      const keywords = pdf.getKeywords()
      results.push({
        label: `PDF Keywords is set`,
        passed: !!keywords && keywords.length > 0,
        detail: !keywords ? 'Keywords is empty' : undefined,
      })
      const creator = pdf.getCreator()
      results.push({
        label: `PDF Creator = "${creator}"`,
        passed: creator === 'LynPDF',
        detail: creator !== 'LynPDF' ? `Got: "${creator}"` : undefined,
      })
      const raw = buf.toString('latin1')
      const hasProducer = raw.includes('LynPDF (PDFKit)') || raw.includes('LynPDF \\(PDFKit\\)')
      results.push({
        label: `PDF Producer contains "LynPDF"`,
        passed: hasProducer,
        detail: !hasProducer ? 'Producer string "LynPDF (PDFKit)" not found in raw PDF' : undefined,
      })
      const hasFlate = raw.includes('FlateDecode')
      results.push({
        label: `PDF compression (FlateDecode)`,
        passed: hasFlate,
        detail: hasFlate ? undefined : 'No FlateDecode stream found',
      })
      // Check PDF version header (should be 1.7 by default)
      const versionMatch = raw.match(/^%PDF-([\d.]+)/)
      const pdfVer = versionMatch ? versionMatch[1] : 'unknown'
      results.push({
        label: `PDF version: ${pdfVer}`,
        passed: pdfVer === '1.7',
        detail: pdfVer !== '1.7' ? `Expected 1.7, got ${pdfVer}` : undefined,
      })
      return results
    },
  },
  'test-13-tlwg-fonts.html': {
    name: 'TLWG Thai Fonts (ฟอนต์ TLWG)',
    minPages: 1, maxPages: 10,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      await assertHasEmbeddedFonts(buf),
      assertFileSize(buf, 10, 2000),
    ],
  },
  'test-14-text-justify.html': {
    name: 'Text Justify (text-align: justify)',
    minPages: 1, maxPages: 5,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      await assertHasEmbeddedFonts(buf),
      assertFileSize(buf, 5, 500),
    ],
  },
  'test-15-pali-sanskrit.html': {
    name: 'บาลี/สันสกฤต — อักขระพิเศษ ฎ ฏ ฐ ญ ฬ (Pali/Sanskrit)',
    minPages: 2, maxPages: 15,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      await assertHasEmbeddedFonts(buf),
      assertFileSize(buf, 10, 2000),
    ],
  },
  'test-16-page-margin.html': {
    name: 'Page Margins',
    minPages: 2, maxPages: 6,
    assertions: async (pdf, buf) => [
      assertPageSize(pdf, 595.28, 841.89),
      assertPageCountRange(pdf, 2, 6),
      assertFileSize(buf, 5, 2000),
    ],
  },
  'test-17-page-orientation.html': {
    name: 'Page Orientation (Landscape)',
    minPages: 1, maxPages: 3,
    assertions: async (pdf, buf) => [
      // A4 landscape: 841.89 × 595.28 pt
      assertPageSize(pdf, 841.89, 595.28),
      assertFileSize(buf, 5, 2000),
    ],
  },
}

/**
 * Auto-discover all .html fixtures and build the test list.
 * Known fixtures get custom assertions from TEST_CASE_CONFIG.
 * Unknown fixtures get sensible defaults so new tests are never silently skipped.
 */
function discoverTestCases (): TestCase[] {
  const fixturesDir = path.join(__dirname, 'fixtures')
  const htmlFiles = fs.readdirSync(fixturesDir)
    .filter(f => f.startsWith('test-') && f.endsWith('.html'))
    .sort()

  return htmlFiles.map((htmlFile, idx) => {
    // Derive a numeric id from filename, e.g. test-03-tables.html → '3.1'
    const numMatch = htmlFile.match(/^test-(\d+)/)
    const num = numMatch ? parseInt(numMatch[1], 10) : idx + 1
    const id = `${num}.1`

    // Derive a human-readable name from filename if not configured
    const baseName = htmlFile.replace(/^test-\d+-/, '').replace('.html', '').replace(/-/g, ' ')
    const defaultName = baseName.charAt(0).toUpperCase() + baseName.slice(1)

    const config = TEST_CASE_CONFIG[htmlFile]

    return {
      id,
      name: config?.name ?? defaultName,
      htmlFile,
      minPages: config?.minPages ?? 1,
      maxPages: config?.maxPages ?? 50,
      pages: config?.pages,
      assertions: config?.assertions ?? (async (pdf, buf) => [
        assertPageSize(pdf, 595.28, 841.89),
        await assertHasEmbeddedFonts(buf),
        assertFileSize(buf, 5, 5000),
      ]),
      unimplemented: config?.unimplemented,
    } satisfies TestCase
  })
}

// ─── Runner ──────────────────────────────────────────────────

async function runTest (tc: TestCase, creator: PDFCreator, css: string): Promise<TestResult> {
  const htmlPath = path.join(__dirname, 'fixtures', tc.htmlFile)
  const outPath = path.join(__dirname, 'output', tc.htmlFile.replace('.html', '.pdf'))

  const result: TestResult = {
    id: tc.id,
    name: tc.name,
    passed: true,
    skipped: tc.unimplemented ?? false,
    duration: 0,
    pdfPath: outPath,
    pages: 0,
    assertions: [],
  }

  const t0 = performance.now()

  try {
    // Read HTML
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Fixture not found: ${htmlPath}`)
    }
    const html = fs.readFileSync(htmlPath, 'utf-8')

    // Generate PDF
    await creator.createPDF(html, css, outPath)

    // Read back and inspect
    const buf = fs.readFileSync(outPath) as Buffer
    const pdf = await PDFDocument.load(buf)
    result.pages = pdf.getPageCount()

    // Page count assertions
    if (tc.pages != null) {
      const a = assertPageCount(pdf, tc.pages)
      result.assertions.push(a)
      if (!a.passed) result.passed = false
    } else {
      if (tc.minPages != null || tc.maxPages != null) {
        const min = tc.minPages ?? 1
        const max = tc.maxPages ?? 999
        const a = assertPageCountRange(pdf, min, max)
        result.assertions.push(a)
        if (!a.passed) result.passed = false
      }
    }

    // Custom assertions
    if (tc.assertions) {
      const custom = await tc.assertions(pdf, buf)
      for (const a of custom) {
        result.assertions.push(a)
        if (!a.passed) result.passed = false
      }
    }
  } catch (err: any) {
    result.passed = false
    result.error = err.message ?? String(err)
  }

  result.duration = performance.now() - t0
  return result
}

async function main () {
  console.log(c.bold('\n╔══════════════════════════════════════════════════════════╗'))
  console.log(c.bold('║          LynPDF Creator — Test Suite                     ║'))
  console.log(c.bold('╚══════════════════════════════════════════════════════════╝\n'))

  // Ensure output directory
  const outDir = path.join(__dirname, 'output')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  // Load shared CSS
  const cssPath = path.join(__dirname, 'fixtures', 'test-styles.css')
  const css = fs.readFileSync(cssPath, 'utf-8')

  const creator = new PDFCreator({ verbose: false, colorEmoji: true })

  const TEST_CASES = discoverTestCases()
  console.log(c.dim(`  Discovered ${TEST_CASES.length} fixture(s) in tests/fixtures/\n`))

  const results: TestResult[] = []
  let passCount = 0
  let failCount = 0
  let skipCount = 0

  for (const tc of TEST_CASES) {
    const prefix = `[${tc.id}]`
    process.stdout.write(`  ${c.dim(prefix)} ${tc.name} ... `)

    const result = await runTest(tc, creator, css)
    results.push(result)

    if (result.skipped) {
      skipCount++
      console.log(c.yellow('SKIP') + c.dim(` (${result.duration.toFixed(0)}ms, ${result.pages}p)`))
    } else if (result.passed) {
      passCount++
      console.log(c.green('PASS') + c.dim(` (${result.duration.toFixed(0)}ms, ${result.pages}p)`))
    } else {
      failCount++
      console.log(c.red('FAIL') + c.dim(` (${result.duration.toFixed(0)}ms, ${result.pages}p)`))
    }

    // Print assertion details
    for (const a of result.assertions) {
      const icon = a.passed ? c.green('  ✓') : c.red('  ✗')
      const detail = a.detail ? c.dim(` — ${a.detail}`) : ''
      console.log(`${icon} ${a.label}${detail}`)
    }

    if (result.error) {
      console.log(c.red(`  ✗ Error: ${result.error}`))
    }
  }

  // Summary
  console.log(c.bold('\n──────────────────────────────────────────────────────────'))
  console.log(c.bold('  Summary:'))
  console.log(`    ${c.green(`${passCount} passed`)}  ${c.red(`${failCount} failed`)}  ${c.yellow(`${skipCount} skipped`)}  (${results.length} total)`)
  console.log()

  // List output files
  console.log(c.dim('  Generated PDFs:'))
  for (const r of results) {
    const icon = r.passed ? '✓' : '✗'
    const col = r.passed ? c.green : c.red
    console.log(col(`    ${icon} ${path.basename(r.pdfPath)} (${r.pages} pages)`))
  }
  console.log()

  // Exit code
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(c.red('Fatal error:'), err)
  process.exit(2)
})
