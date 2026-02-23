# LynPDF Creator 🐱

**HTML/CSS → PDF converter with Thai language support, color emoji, and flexbox layout.**

> **"Lyn"** (pronounced "หลิน" — *Lin*) is the name of a little cat. She inspires this project's goal: creating beautiful PDF documents with graceful simplicity.

---

## Features

- 📄 **HTML + CSS → PDF** — Convert standard HTML/CSS to pixel-perfect PDFs without Headless Browser
- 🇹🇭 **Thai Language** — 20+ Thai font families (Google Fonts + TLWG), word segmentation via `Intl.Segmenter`, stacked vowels/tone marks, and `text-align: justify`
- 🕉️ **Pali / Sanskrit** — Correct rendering of นิคหิต ( ํ ), พินทุ ( ฺ ), ทัณฑฆาต ( ์ ), stacked diacritics via HarfBuzz GSUB/GPOS
- 😀 **Color Emoji** — Full-color Twemoji PNG rendering (auto-downloaded and cached)
- 📐 **Flexbox Layout** — Powered by [Yoga Layout](https://github.com/nicklockwood/yoga) for accurate CSS Flexbox positioning
- 🔡 **OpenType Shaping** — HarfBuzz GSUB (ligatures: fi fl ff) + GPOS (kerning pairs) for all fonts
- 🔤 **Font Support** — TTF, **OTF** (IBM Plex Sans), and **Variable Fonts** (Inter Variable) with automatic weight/style resolution
- 📊 **Tables** — Full HTML tables with `thead` repeat on every page; disable with `-lynpdf-repeat: none`
- 🖼️ **SVG & Images** — Inline SVG vector rendering, `<img>` tags, CSS backgrounds
- 🖨️ **Page Rules** — `@page` margins (pt/px/in/cm/mm), `counter(page)` / `counter(pages)`, top/bottom headers & footers
- 📋 **PDF Metadata** — Title, Author, Subject, Keywords auto-read from HTML `<meta>` tags
- 🔌 **Dual Interface** — CLI tool or programmatic TypeScript API
- 📦 **NPM Ready** — Publish-ready package with full TypeScript types
- ⚡ **Fast** — Bun runtime, font metric caching, Twemoji PNG caching (~500–700 ms for complex documents)

## Installation

```bash
# Using bun
bun add lynpdf

# Using npm
npm install lynpdf

# Using pnpm
pnpm add lynpdf
```

## Quick Start

### CLI Usage

```bash
# Basic: HTML → PDF (output: input.pdf)
lynpdf report.html

# With external CSS
lynpdf report.html -c styles.css -o output.pdf

# From stdin
echo "<h1>Hello PDF</h1>" | lynpdf --stdin -o hello.pdf

# With options
lynpdf invoice.html -c theme.css -o invoice.pdf --page-size A4 --margin 50 --verbose
```

### API Usage

```typescript
import { PDFCreator } from 'lynpdf'

const creator = new PDFCreator()

// From strings
await creator.createPDF(
  '<h1>Hello World</h1><p>สวัสดีชาวโลก 🌍</p>',
  'h1 { color: #1a1a2e; font-size: 28px; } p { font-size: 16px; }',
  'output.pdf'
)

// From files
await creator.createPDFFromFile('template.html', 'styles.css', 'output.pdf')

// As buffer (for APIs / HTTP responses)
const buffer = await creator.createPDFBuffer(html, css)
```

### Framework Integration

**Express.js / Fastify:**

```typescript
import { PDFCreator } from 'lynpdf'
import express from 'express'

const app = express()
const creator = new PDFCreator()

app.get('/invoice/:id', async (req, res) => {
  const html = renderInvoiceTemplate(req.params.id)
  const css = readCSS()
  const buffer = await creator.createPDFBuffer(html, css)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', 'attachment; filename=invoice.pdf')
  res.send(buffer)
})
```

**Next.js API Route:**

```typescript
import { PDFCreator } from 'lynpdf'

export async function GET(request: Request) {
  const creator = new PDFCreator()
  const buffer = await creator.createPDFBuffer('<h1>Report</h1>', 'h1 { color: blue; }')

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename=report.pdf',
    },
  })
}
```

**Hono:**

```typescript
import { Hono } from 'hono'
import { PDFCreator } from 'lynpdf'

const app = new Hono()
const creator = new PDFCreator()

app.get('/pdf', async (c) => {
  const buffer = await creator.createPDFBuffer('<h1>Hello</h1>', '')
  return c.body(buffer, 200, { 'Content-Type': 'application/pdf' })
})
```

## CLI Reference

```
Usage:
  lynpdf <input.html> [options]
  lynpdf -i input.html -c styles.css -o output.pdf
  cat template.html | lynpdf --stdin -o output.pdf

Options:
  -i, --input <file>        Input HTML file
  -o, --output <file>       Output PDF file (default: <input>.pdf)
  -c, --css <file>          External CSS file
      --extra-css <string>  Additional inline CSS string
  -s, --page-size <size>    Page size: A4, A3, letter, legal (default: A4)
  -m, --margin <pts>        Page margin in points (default: 50)
      --color-emoji         Use color Twemoji PNGs (default)
      --no-color-emoji      Use monochrome emoji font
      --stdin               Read HTML from stdin
      --verbose             Print detailed progress
  -v, --version             Show version
  -h, --help                Show help
```

## API Reference

### `PDFCreator`

```typescript
const creator = new PDFCreator(options?: PDFOptions)
```

**PDFOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pageSize` | `string \| [number, number]` | `'A4'` | Paper size: `'A4'`, `'A3'`, `'letter'`, `[w, h]` |
| `margin` | `number \| [t, r, b, l]` | `50` | Page margins in points (`@page` overrides this) |
| `css` | `string` | `undefined` | Additional CSS injected after HTML styles |
| `defaultFont` | `string` | `'Sarabun'` | Default font family name |
| `colorEmoji` | `boolean` | `true` | Use full-color Twemoji PNGs |
| `compress` | `boolean` | `true` | Enable PDF compression |
| `verbose` | `boolean` | `false` | Print detailed progress logs |
| `pdfVersion` | `string` | `'1.7'` | PDF version: `'1.3'`–`'1.7ext3'` |
| `metadata` | `object` | — | `{ Title, Author, Subject, Keywords, Creator, Producer }` |

**Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `createPDF(html, css, outputPath)` | `Promise<PDFResult>` | Generate PDF file |
| `createPDFFromFile(htmlPath, cssPath, outputPath)` | `Promise<PDFResult>` | Generate from files |
| `createPDFBuffer(html, css)` | `Promise<Buffer>` | Generate as Buffer |

## Supported CSS Properties

| Category | Properties |
|----------|-----------|
| **Layout** | `display: flex/block/inline`, `flex-direction`, `flex-wrap`, `justify-content`, `align-items`, `flex`, `flex-grow`, `flex-shrink`, `flex-basis`, `gap` |
| **Box Model** | `width`, `height`, `min/max-width/height`, `padding`, `margin`, `border`, `border-radius`, `border-collapse`, `overflow` |
| **Typography** | `font-family`, `font-size`, `font-weight`, `font-style`, `line-height`, `text-align` (incl. `justify`), `color`, `letter-spacing`, `word-spacing`, `text-decoration` |
| **Visual** | `background-color` (hex/rgb/rgba/named), `opacity`, `border-radius`, `border` (shorthand + sides) |
| **Page Media** | `@page` (margin in pt/px/in/cm/mm), `@page :first`, `page-break-before/after/inside`, `break-before/inside`, `counter(page)`, `counter(pages)`, `orphans`, `widows` |
| **LynPDF Custom** | `-lynpdf-repeat: none` — disable thead repeat on a table or thead element |

## Supported HTML Elements

`div`, `p`, `h1`–`h4`, `span`, `strong`, `b`, `em`, `i`, `br`, `table`, `thead`, `tbody`, `tfoot`, `tr`, `td`, `th`, `ul`, `ol`, `li`, `img`, `svg`

## Included Fonts

### Google Fonts (Thai + Latin)

| Font Family | Variants | Notes |
|-------------|----------|-------|
| **Sarabun** | Regular, Bold, Italic, Bold Italic | Default font |
| **Prompt** | Regular, Bold, Italic, Bold Italic | |
| **Kanit** | Regular, Bold, Italic, Bold Italic | |
| **Mitr** | Regular, Bold | |
| **Chakra Petch** | Regular, Bold, Italic, Bold Italic | |

### TLWG Fonts (Thai + Pali/Sanskrit)

| Font Family | Type | Variants |
|-------------|------|----------|
| **Garuda** | Sans-serif | Regular, Bold, Oblique, BoldOblique |
| **Loma** | Sans-serif | Regular, Bold, Oblique, BoldOblique |
| **Norasi** | Serif | Regular, Bold, Italic, BoldItalic |
| **Kinnari** | Serif | Regular, Bold, Italic, BoldItalic |
| **Laksaman** | Serif | Regular, Bold, Italic, BoldItalic |
| **Sawasdee** | Sans-serif | Regular, Bold, Oblique, BoldOblique |
| **Purisa** | Handwriting | Regular, Bold, Oblique, BoldOblique |
| **Waree** | Sans-serif | Regular, Bold, Oblique, BoldOblique |
| **Umpush** | Sans-serif | Regular, Bold, Light, Oblique |
| **TlwgMono** | Monospace | Regular, Bold |
| **TlwgTypewriter** | Monospace | Regular, Bold |
| **TlwgTypist** | Monospace | Regular, Bold |
| **TlwgTypo** | Monospace | Regular, Bold |

### Specialty Fonts

| Font Family | Format | Notes |
|-------------|--------|-------|
| **IBM Plex Sans** | OTF | Full OpenType kerning + ligatures |
| **Inter Variable** | Variable TTF | Single file, weight 100–900 |
| **NotoEmoji** | Variable | Monochrome emoji fallback |

## Architecture

```
HTML → parse5 → DOM tree
CSS  → css-tree → Stylesheet AST
                         ↓
              StyleResolver (CSS selector cascade)
                         ↓
              LayoutEngine (Yoga Flexbox)
                         ↓
              Post-Layout Passes:
                • applyPageFlow  (page-breaks, footer-zone, thead integrity)
                • applyOrphansWidows
                • applyTheadRepeatShift (-lynpdf-repeat)
                • anchorPageBreaks
                         ↓
              PDFRenderer (PDFKit + HarfBuzz + Twemoji)
                         ↓
                     PDF file
```

**Key Technologies:**

- **[Yoga Layout](https://github.com/nicklockwood/yoga)** — Meta's cross-platform Flexbox engine (C++ → WASM)
- **[PDFKit](https://pdfkit.org/)** — PDF generation library for Node.js
- **[fontkit](https://github.com/foliojs/fontkit)** — Advanced font rendering engine with HarfBuzz shaping (GSUB + GPOS)
- **[Twemoji](https://github.com/jdecked/twemoji)** — Twitter's open-source color emoji (PNG)
- **[parse5](https://github.com/inikulin/parse5)** — Spec-compliant HTML5 parser
- **[css-tree](https://github.com/csstree/csstree)** — CSS parser and AST toolkit
- **[svg-to-pdfkit](https://github.com/alafr/SVG-to-PDFKit)** — Inline SVG vector rendering
- **`Intl.Segmenter`** — Thai word segmentation (built-in, locale: th-TH)

## Development

```bash
# Install dependencies
bun install

# Run all examples
bun run examples

# Generate a single PDF via CLI
bun run cli -- examples/demo-single-page.html -c examples/styles.css -o test.pdf

# Type check
bun run typecheck

# Build for distribution
bun run build
```

## License

MIT — see [LICENSE](LICENSE) for details.

---

*Made with 💛 by the LynPDF team. Meow!* 🐱
