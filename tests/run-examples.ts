/**
 * LynPDF Creator — Example runner
 *
 * Generates all example PDFs from the examples/ directory.
 */

import * as fs from 'fs'
import { PDFCreator } from '../src/pdf-creator'
import { TextShaper } from '../src/text/text-shaper'

async function main () {
  const creator = new PDFCreator({ verbose: true })

  // Test Thai word segmentation
  const thaiText = 'ทดสอบการสร้างเอกสารภาษาไทยที่มีสระลอยและวรรณยุกต์ซ้อน เช่น น้ำพริก ผู้ใหญ่'
  console.log('Thai Word Segmentation Test:', TextShaper.segmentThaiWords(thaiText))

  const css = fs.readFileSync('examples/styles.css', 'utf-8')

  const examples: Array<{ html: string; out: string }> = [
    { html: 'examples/multipage.html', out: 'examples/output/output-multipage.pdf' },
    { html: 'examples/invoice.html', out: 'examples/output/output-invoice.pdf' },
    { html: 'examples/typography.html', out: 'examples/output/output-typography.pdf' },
    { html: 'examples/demo-single-page.html', out: 'examples/output/output-demo-single-page.pdf' },
    { html: 'examples/demo-multipage.html', out: 'examples/output/output-demo-multipage.pdf' },
    { html: 'examples/demo-tables.html', out: 'examples/output/output-demo-tables.pdf' },
    { html: 'examples/demo-images.html', out: 'examples/output/output-demo-images.pdf' },
    { html: 'examples/demo-typography.html', out: 'examples/output/output-demo-typography.pdf' },
    { html: 'examples/demo-invoice.html', out: 'examples/output/output-demo-invoice.pdf' },
    { html: 'examples/demo-thai-fonts.html', out: 'examples/output/output-demo-thai-fonts.pdf' },
    { html: 'examples/demo-certificate.html', out: 'examples/output/output-demo-certificate.pdf' },
    { html: 'examples/demo-font-showcase.html', out: 'examples/output/output-demo-font-showcase.pdf' },
    { html: 'examples/book-lynpdf-guide.html', out: 'examples/output/output-book-lynpdf-guide.pdf' },
  ]

  for (const ex of examples) {
    const html = fs.readFileSync(ex.html, 'utf-8')
    await creator.createPDF(html, css, ex.out)
  }
}

main().catch(console.error)
