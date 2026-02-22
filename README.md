# LynPDF Creator 🐱

**HTML/CSS → PDF converter with Thai language support, color emoji, and flexbox layout.**

> **"Lyn"** (pronounced "หลิน" — *Lin*) is the name of a little cat. She inspires this project's goal: creating beautiful PDF documents with graceful simplicity.

---

## Features

- 📄 **HTML + CSS → PDF** — Convert standard HTML/CSS to pixel-perfect PDFs
- 🇹🇭 **Thai Language Support** — Full Thai text rendering with 5 font families (Sarabun, Prompt, Kanit, Mitr, Chakra Petch), proper word segmentation via `Intl.Segmenter`, and stacked vowels/tone marks
- 😀 **Color Emoji** — Full-color Twemoji PNG rendering (auto-downloaded and cached)
- 📐 **Flexbox Layout** — Powered by [Yoga Layout](https://github.com/nicklockwood/yoga) for accurate CSS Flexbox positioning
- 📊 **Rich Elements** — Tables, lists, SVG inline, images, backgrounds, borders, multi-page support
- 🖨️ **Page Headers/Footers** — CSS `@page` rules with `counter(page)` / `counter(pages)`
- 🔤 **Typography** — Font weight (bold/italic), text alignment, line-height, font-size, color
- 🔌 **Dual Interface** — Use as a CLI tool or programmatic API
- 📦 **NPM Ready** — Publish-ready package with TypeScript types
- ⚡ **Fast** — Optimized with Bun runtime, font metric caching, and Twemoji PNG caching

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
| `pageSize` | `string \| [number, number]` | `'A4'` | Paper size |
| `margin` | `number \| [t, r, b, l]` | `50` | Page margins (points) |
| `css` | `string` | `undefined` | Additional CSS |
| `defaultFont` | `string` | `'Sarabun'` | Default font path |
| `colorEmoji` | `boolean` | `true` | Use color Twemoji PNGs |
| `verbose` | `boolean` | `false` | Print logs |

**Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `createPDF(html, css, outputPath)` | `Promise<PDFResult>` | Generate PDF file |
| `createPDFFromFile(htmlPath, cssPath, outputPath)` | `Promise<PDFResult>` | Generate from files |
| `createPDFBuffer(html, css)` | `Promise<Buffer>` | Generate as Buffer |

## Supported CSS Properties

| Category | Properties |
|----------|-----------|
| **Layout** | `display: flex`, `flex-direction`, `flex-wrap`, `justify-content`, `align-items`, `flex`, `flex-grow`, `flex-shrink`, `flex-basis` |
| **Box Model** | `width`, `height`, `min-width`, `max-width`, `min-height`, `max-height`, `padding`, `margin`, `border` |
| **Typography** | `font-family`, `font-size`, `font-weight`, `font-style`, `line-height`, `text-align`, `color` |
| **Visual** | `background-color`, `border` (shorthand + sides), `border-collapse` |
| **Page** | `@page`, `@page :first`, `page-break-before`, `counter(page)`, `counter(pages)` |

## Supported HTML Elements

`div`, `p`, `h1`–`h4`, `span`, `strong`, `b`, `em`, `i`, `br`, `table`, `thead`, `tbody`, `tfoot`, `tr`, `td`, `th`, `ul`, `ol`, `li`, `img`, `svg`

## Included Fonts

| Font Family | Variants | Language |
|-------------|----------|----------|
| **Sarabun** | Regular, Bold, Italic, Bold Italic | Thai + Latin |
| **Prompt** | Regular, Bold, Italic, Bold Italic | Thai + Latin |
| **Kanit** | Regular, Bold, Italic, Bold Italic | Thai + Latin |
| **Mitr** | Regular, Bold | Thai + Latin |
| **Chakra Petch** | Regular, Bold, Italic, Bold Italic | Thai + Latin |
| **NotoEmoji** | Variable weight | Emoji (monochrome fallback) |

## Architecture

```
HTML → parse5 → DOM tree
CSS  → css-tree → Stylesheet AST
                         ↓
              StyleResolver (CSS cascade)
                         ↓
              LayoutEngine (Yoga Flexbox)
                         ↓
              PDFRenderer (PDFKit + Twemoji)
                         ↓
                     PDF file
```

**Key Technologies:**

- **[Yoga Layout](https://github.com/nicklockwood/yoga)** — Facebook's cross-platform Flexbox engine
- **[PDFKit](https://pdfkit.org/)** — PDF generation library for Node.js
- **[fontkit](https://github.com/foliojs/fontkit)** — Advanced font rendering engine
- **[Twemoji](https://github.com/jdecked/twemoji)** — Twitter's open-source color emoji
- **[parse5](https://github.com/inikulin/parse5)** — Spec-compliant HTML parser
- **[css-tree](https://github.com/csstree/csstree)** — CSS parser and generator

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
