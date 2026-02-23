import * as fs from 'fs'
import { LayoutEngine } from './layout/layout-engine'
import { CSSParser } from './parser/css-parser'
import { HTMLParser } from './parser/html-parser'
import { PDFRenderer, type RenderOptions } from './renderer/pdf-renderer'

/**
 * Options for PDF generation.
 */
export interface PDFOptions {
  /** Paper size (default: 'A4'). Supports 'A4', 'A3', 'letter', 'legal', or [width, height] in points. */
  pageSize?: string | [number, number]
  /** Page margins in points: number (all sides) or [top, right, bottom, left] */
  margin?: number | [number, number, number, number]
  /** Additional CSS to apply (appended after linked/inline CSS) */
  css?: string
  /** Path to the default font file (.ttf or .otf). Default: fonts/Sarabun-Regular.ttf */
  defaultFont?: string
  /** Whether to use color emoji (Twemoji PNG). Default: true */
  colorEmoji?: boolean
  /** Whether to print verbose logs. Default: false */
  verbose?: boolean
  /** Enable PDF compression (default: true) */
  compress?: boolean  /** PDF version: '1.3' | '1.4' | '1.5' | '1.6' | '1.7' | '1.7ext3' (default: '1.7') */
  pdfVersion?: string;  /** PDF metadata overrides. If not provided, values from HTML <meta> tags are used. */
  metadata?: {
    Title?: string
    Author?: string
    Subject?: string
    Keywords?: string
    Creator?: string
    Producer?: string
  }
}

/**
 * Result of PDF generation.
 */
export interface PDFResult {
  /** Output file path */
  path: string
  /** Number of pages in the generated PDF */
  pages: number
  /** Time taken in milliseconds */
  elapsed: number
}

/**
 * LynPDF Creator — HTML/CSS to PDF converter.
 *
 * **Usage (API):**
 * ```ts
 * import { PDFCreator } from 'lynpdf'
 *
 * const creator = new PDFCreator()
 * await creator.createPDF('<h1>Hello</h1>', 'h1 { color: red; }', 'output.pdf')
 * ```
 *
 * **Usage (file-based):**
 * ```ts
 * await creator.createPDFFromFile('template.html', 'styles.css', 'output.pdf')
 * ```
 */
export class PDFCreator {
  private options: PDFOptions

  constructor(options: PDFOptions = {}) {
    this.options = {
      pageSize: 'A4',
      margin: 50,
      colorEmoji: true,
      verbose: false,
      ...options,
    }
  }

  /**
   * Generate a PDF from HTML and CSS strings.
   * @param html Raw HTML string
   * @param css Raw CSS string
   * @param outputPath Output file path for the PDF
   * @returns PDFResult with metadata
   */
  async createPDF(html: string, css: string, outputPath: string): Promise<PDFResult> {
    const t0 = performance.now()
    const log = this.options.verbose ? console.log.bind(console) : () => {}

    log('1. Parsing HTML...')
    const dom = HTMLParser.parse(html)

    // Extract <style> blocks from HTML
    let inlineCss = ''
    const extractStyles = (node: any) => {
      if (node.nodeName === 'style' && node.childNodes?.length > 0) {
        inlineCss += node.childNodes[0].value + '\n'
      }
      if (node.childNodes) {
        for (const child of node.childNodes) {
          extractStyles(child)
        }
      }
    }
    extractStyles(dom)

    // ── Extract PDF metadata from HTML <title> and <meta> tags ──
    const htmlMeta: Record<string, string> = {}
    const extractMeta = (node: any) => {
      if (node.nodeName === 'title' && node.childNodes?.length > 0) {
        htmlMeta['Title'] = node.childNodes[0].value?.trim() || ''
      }
      if (node.nodeName === 'meta' && node.attrs) {
        const attrs: Record<string, string> = {}
        for (const a of node.attrs) attrs[a.name.toLowerCase()] = a.value
        const name = (attrs['name'] || '').toLowerCase()
        const content = attrs['content'] || ''
        if (name === 'author') htmlMeta['Author'] = content
        if (name === 'description') htmlMeta['Subject'] = content
        if (name === 'keywords') htmlMeta['Keywords'] = content
        if (name === 'creator' || name === 'generator') htmlMeta['Creator'] = content
        if (name === 'producer') htmlMeta['Producer'] = content
        // Additional: allow pdf-specific meta
        if (name === 'pdf-title') htmlMeta['Title'] = content
        if (name === 'pdf-author') htmlMeta['Author'] = content
        if (name === 'pdf-subject') htmlMeta['Subject'] = content
        if (name === 'pdf-keywords') htmlMeta['Keywords'] = content
      }
      if (node.childNodes) {
        for (const child of node.childNodes) extractMeta(child)
      }
    }
    extractMeta(dom)

    log('2. Parsing CSS...')
    const combinedCss = css + '\n' + inlineCss + '\n' + (this.options.css || '')
    const styles = CSSParser.parse(combinedCss)

    log('3. Calculating Layout...')
    const layoutResult = LayoutEngine.calculate(dom, styles)

    log('4. Rendering PDF...')
    // Build render options: compression + metadata
    const renderOpts: RenderOptions = {
      compress: this.options.compress !== false, // default: true
      pdfVersion: this.options.pdfVersion || '1.7',
      info: {
        ...htmlMeta,
        ...this.options.metadata, // user overrides win
      },
    }
    const renderer = new PDFRenderer()
    await renderer.render(layoutResult.rootNode, outputPath, layoutResult.pageRules, renderOpts, layoutResult.fontFaceRules, layoutResult.pageMargin)

    const elapsed = performance.now() - t0
    const pages = Math.ceil(layoutResult.rootNode.height / 841.89)
    log(`PDF created: ${outputPath} (${pages} page(s), ${elapsed.toFixed(0)}ms)`)

    return { path: outputPath, pages, elapsed }
  }

  /**
   * Generate a PDF from HTML and CSS files.
   * @param htmlPath Path to the HTML file
   * @param cssPath Path to the CSS file (optional — inline styles and linked stylesheets are extracted from HTML)
   * @param outputPath Output file path for the PDF
   * @returns PDFResult with metadata
   */
  async createPDFFromFile(htmlPath: string, cssPath: string | undefined, outputPath: string): Promise<PDFResult> {
    const html = fs.readFileSync(htmlPath, 'utf-8')

    // Extract linked stylesheets from HTML
    let css = ''
    if (cssPath) {
      css = fs.readFileSync(cssPath, 'utf-8')
    }

    // Also look for <link rel="stylesheet"> in the HTML
    const linkRe = /<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi
    let match
    while ((match = linkRe.exec(html)) !== null) {
      const href = match[1]
      if (href) {
        const basePath = require('path')
        const cssFilePath = basePath.resolve(basePath.dirname(htmlPath), href)
        if (fs.existsSync(cssFilePath) && cssFilePath !== cssPath) {
          css += '\n' + fs.readFileSync(cssFilePath, 'utf-8')
        }
      }
    }

    return this.createPDF(html, css, outputPath)
  }

  /**
   * Generate a PDF and return it as a Buffer (useful for APIs/streams).
   * @param html Raw HTML string
   * @param css Raw CSS string
   * @returns Buffer containing the PDF data
   */
  async createPDFBuffer(html: string, css: string): Promise<Buffer> {
    const tmpPath = `/tmp/lynpdf_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`
    try {
      await this.createPDF(html, css, tmpPath)
      return fs.readFileSync(tmpPath)
    } finally {
      try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    }
  }
}
