#!/usr/bin/env node
/**
 * LynPDF Creator — CLI
 *
 * Convert HTML + CSS to PDF from the command line.
 *
 * Usage:
 *   lynpdf <input.html> [options]
 *   lynpdf -i input.html -c styles.css -o output.pdf
 *
 * Examples:
 *   lynpdf template.html                          # → template.pdf
 *   lynpdf template.html -o report.pdf            # → report.pdf
 *   lynpdf template.html -c theme.css -o out.pdf  # With external CSS
 *   lynpdf template.html --no-color-emoji         # Disable color emoji (use monochrome)
 *   echo "<h1>Hi</h1>" | lynpdf --stdin -o hi.pdf # From stdin
 */

import * as fs from 'fs'
import * as path from 'path'
import { PDFCreator } from './pdf-creator'

// ── Parse arguments ──────────────────────────────────────────

interface CliArgs {
  input?: string
  output?: string
  css?: string
  extraCss?: string
  pageSize?: string
  margin?: string
  pdfVersion?: string
  compress: boolean
  colorEmoji: boolean
  verbose: boolean
  stdin: boolean
  help: boolean
  version: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    compress: true,
    colorEmoji: true,
    verbose: false,
    stdin: false,
    help: false,
    version: false,
  }

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]!
    switch (arg) {
      case '-h':
      case '--help':
        args.help = true
        break
      case '-v':
      case '--version':
        args.version = true
        break
      case '-i':
      case '--input':
        args.input = argv[++i]
        break
      case '-o':
      case '--output':
        args.output = argv[++i]
        break
      case '-c':
      case '--css':
        args.css = argv[++i]
        break
      case '--extra-css':
        args.extraCss = argv[++i]
        break
      case '-s':
      case '--page-size':
        args.pageSize = argv[++i]
        break
      case '-m':
      case '--margin':
        args.margin = argv[++i]
        break
      case '--pdf-version':
        args.pdfVersion = argv[++i]
        break
      case '--compress':
        args.compress = true
        break
      case '--no-compress':
        args.compress = false
        break
      case '--no-color-emoji':
        args.colorEmoji = false
        break
      case '--color-emoji':
        args.colorEmoji = true
        break
      case '--verbose':
        args.verbose = true
        break
      case '--stdin':
        args.stdin = true
        break
      default:
        // Positional: first positional is input, second is output
        if (!arg.startsWith('-')) {
          if (!args.input) args.input = arg
          else if (!args.output) args.output = arg
        } else {
          console.error(`Unknown option: ${arg}`)
          process.exit(1)
        }
    }
    i++
  }

  return args
}

function showHelp(): void {
  console.log(`
LynPDF Creator — HTML/CSS to PDF converter
"Lyn" (หลิน) is the name of a little cat 🐱

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
      --pdf-version <ver>   PDF version: 1.3, 1.4, 1.5, 1.6, 1.7 (default: 1.7)
      --compress            Enable compression (default)
      --no-compress         Disable compression (larger file, faster)
      --color-emoji         Use color Twemoji PNGs (default)
      --no-color-emoji      Use monochrome emoji font
      --stdin               Read HTML from stdin
      --verbose             Print detailed logs
  -v, --version             Show version
  -h, --help                Show this help

Examples:
  lynpdf report.html
  lynpdf report.html -c corporate.css -o Q4-report.pdf
  lynpdf invoice.html --page-size letter --margin 72
  echo "<h1>Hello PDF</h1>" | lynpdf --stdin -o hello.pdf
`)
}

function showVersion(): void {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'))
    console.log(`lynpdf v${pkg.version}`)
  } catch {
    console.log('lynpdf v0.1.0')
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    showHelp()
    return
  }

  if (args.version) {
    showVersion()
    return
  }

  // Get HTML
  let html: string
  let htmlPath: string | undefined

  if (args.stdin) {
    html = await readStdin()
  } else if (args.input) {
    htmlPath = path.resolve(args.input)
    if (!fs.existsSync(htmlPath)) {
      console.error(`Error: File not found: ${htmlPath}`)
      process.exit(1)
    }
    html = fs.readFileSync(htmlPath, 'utf-8')
  } else {
    console.error('Error: No input file specified. Use -h for help.')
    process.exit(1)
  }

  // Output path
  const outputPath = args.output
    ? path.resolve(args.output)
    : htmlPath
      ? htmlPath.replace(/\.\w+$/, '.pdf')
      : 'output.pdf'

  // CSS
  let css = ''

  // External CSS file
  if (args.css) {
    const cssPath = path.resolve(args.css)
    if (!fs.existsSync(cssPath)) {
      console.error(`Error: CSS file not found: ${cssPath}`)
      process.exit(1)
    }
    css = fs.readFileSync(cssPath, 'utf-8')
  }

  // Extract <link rel="stylesheet"> from HTML
  if (htmlPath) {
    const linkRe = /<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi
    let match
    while ((match = linkRe.exec(html)) !== null) {
      const href = match[1]
      if (href) {
        const cssFilePath = path.resolve(path.dirname(htmlPath), href)
        if (fs.existsSync(cssFilePath) && cssFilePath !== (args.css ? path.resolve(args.css) : '')) {
          css += '\n' + fs.readFileSync(cssFilePath, 'utf-8')
        }
      }
    }
  }

  // Parse margin
  let margin: number | undefined
  if (args.margin) {
    margin = parseInt(args.margin, 10)
    if (isNaN(margin)) {
      console.error('Error: Invalid margin value')
      process.exit(1)
    }
  }

  // Create PDF
  const creator = new PDFCreator({
    pageSize: args.pageSize || 'A4',
    margin,
    css: args.extraCss,
    pdfVersion: args.pdfVersion,
    compress: args.compress,
    colorEmoji: args.colorEmoji,
    verbose: args.verbose,
  })

  const t0 = performance.now()

  try {
    const result = await creator.createPDF(html, css, outputPath)
    const elapsed = (performance.now() - t0).toFixed(0)
    console.log(`✓ ${path.basename(outputPath)} (${result.pages} page${result.pages > 1 ? 's' : ''}, ${elapsed}ms)`)
  } catch (err: any) {
    console.error(`Error generating PDF: ${err.message || err}`)
    if (args.verbose) console.error(err.stack)
    process.exit(1)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
