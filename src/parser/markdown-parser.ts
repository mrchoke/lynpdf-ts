/**
 * MarkdownParser — Converts Markdown to HTML for the LynPDF pipeline.
 *
 * Features:
 * - GFM tables, footnotes, task lists
 * - Syntax-highlighted code blocks (highlight.js)
 * - Custom containers: `:::info`, `:::warning`, `:::tip`, `:::card`, `:::note`, etc.
 * - GitHub-style alerts: `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, etc.
 * - Color boxes: `:::box-blue`, `:::box-green`, `:::box-red`, etc.
 * - Mermaid diagram rendering (optional — requires `mmdc` CLI on PATH)
 *
 * @example
 * ```ts
 * import { MarkdownParser } from 'lynpdf'
 *
 * const html = MarkdownParser.toHTML('# Hello\n\nWorld')
 * // → full HTML document with styled heading
 *
 * // With mermaid diagrams (async)
 * const htmlWithDiagrams = await MarkdownParser.toHTMLAsync('```mermaid\ngraph TD; A-->B\n```')
 * ```
 */
import hljs from 'highlight.js'
import MarkdownIt from 'markdown-it'
import containerPlugin from 'markdown-it-container'
import footnotePlugin from 'markdown-it-footnote'
import taskListPlugin from 'markdown-it-task-lists'
import { MARKDOWN_DEFAULT_CSS } from './markdown-default-css'

/**
 * Map of highlight.js class names → inline CSS color (GitHub Light palette).
 * Used to convert `<span class="hljs-keyword">` → `<span style="color:#d73a49">`.
 * This guarantees colors render correctly in the PDF pipeline, which resolves
 * inline styles more reliably than CSS class-based selectors on deep trees.
 */
const HLJS_INLINE_COLORS: Record<string, string> = {
  'hljs-comment': '#6a737d',
  'hljs-quote': '#6a737d',
  'hljs-keyword': '#d73a49',
  'hljs-selector-tag': '#d73a49',
  'hljs-type': '#d73a49',
  'hljs-operator': '#d73a49',
  'hljs-string': '#032f62',
  'hljs-number': '#005cc5',
  'hljs-literal': '#005cc5',
  'hljs-built_in': '#e36209',
  'hljs-builtin-name': '#e36209',
  'hljs-title': '#6f42c1',
  'hljs-section': '#6f42c1',
  'hljs-title function_': '#6f42c1',
  'hljs-attr': '#005cc5',
  'hljs-attribute': '#005cc5',
  'hljs-variable': '#e36209',
  'hljs-template-variable': '#e36209',
  'hljs-regexp': '#032f62',
  'hljs-symbol': '#005cc5',
  'hljs-bullet': '#005cc5',
  'hljs-meta': '#735c0f',
  'hljs-deletion': '#b31d28',
  'hljs-addition': '#22863a',
  'hljs-name': '#22863a',
  'hljs-tag': '#22863a',
  'hljs-subst': '#24292e',
  'hljs-selector-class': '#6f42c1',
  'hljs-selector-id': '#6f42c1',
  'hljs-property': '#005cc5',
  'hljs-params': '#24292e',
  'hljs-punctuation': '#24292e',
}

/**
 * Convert highlight.js class-based `<span>` tags to inline `style="color:…"`.
 * This ensures syntax colors render in the PDF pipeline without relying on
 * CSS class resolution.
 */
function hljsToInlineStyles (html: string): string {
  return html.replace(/<span class="([^"]+)">/g, (_match, classes: string) => {
    // Try exact match first, then first individual class
    let color = HLJS_INLINE_COLORS[classes]
    if (!color) {
      for (const cls of classes.split(' ')) {
        color = HLJS_INLINE_COLORS[cls]
        if (color) break
      }
    }
    if (color) {
      return `<span style="color:${color}">`
    }
    return `<span>`
  })
}

/**
 * Options for Markdown → HTML conversion.
 */
export interface MarkdownOptions {
  /** Include the built-in default CSS for Markdown styling. Default: true */
  includeDefaultCss?: boolean
  /** Wrap the rendered HTML in a full `<html><head>…</head><body>…</body></html>` document. Default: true */
  wrapInDocument?: boolean
  /** Document title (used in `<title>` tag). Default: 'Untitled' */
  title?: string
  /** Attempt to render Mermaid diagrams via `mmdc` CLI. Default: true */
  renderMermaid?: boolean
}

// ── Singleton markdown-it instance ──────────────────────────────────

let _md: MarkdownIt | null = null

/** Container types that get a title bar + icon */
const ALERT_CONTAINERS = ['info', 'tip', 'warning', 'danger', 'caution', 'note', 'important'] as const

/** Color box containers */
const COLOR_BOXES = ['box-blue', 'box-green', 'box-red', 'box-yellow', 'box-purple', 'box-gray', 'box-orange'] as const

/** Icon map for alert containers & GitHub alerts */
const ALERT_ICONS: Record<string, string> = {
  info: 'ℹ️',
  tip: '💡',
  warning: '⚠️',
  danger: '🔴',
  caution: '⚠️',
  note: '📝',
  important: '❗',
}

/** Default titles for alert containers */
const ALERT_TITLES: Record<string, string> = {
  info: 'Info',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
  caution: 'Caution',
  note: 'Note',
  important: 'Important',
}

function getMd (): MarkdownIt {
  if (!_md) {
    _md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      breaks: false,
      highlight (str: string, lang: string): string {
        // Mermaid blocks: render as a special <div> (processed later by `processMermaid`)
        if (lang === 'mermaid') {
          return `<div class="mermaid-block" data-mermaid="${encodeURIComponent(str.trim())}">`
            + `<pre class="mermaid-src"><code>${escapeHtml(str)}</code></pre></div>`
        }

        let highlighted: string
        let resolvedLang = lang

        if (lang && hljs.getLanguage(lang)) {
          try {
            highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
          } catch {
            highlighted = escapeHtml(str)
            resolvedLang = ''
          }
        } else if (!lang && str.trim().length > 20) {
          // Auto-detect if no language specified (only for non-trivial blocks)
          try {
            const result = hljs.highlightAuto(str)
            if (result.relevance > 5) {
              highlighted = result.value
              resolvedLang = result.language ?? ''
            } else {
              highlighted = escapeHtml(str)
              resolvedLang = ''
            }
          } catch {
            highlighted = escapeHtml(str)
            resolvedLang = ''
          }
        } else {
          highlighted = escapeHtml(str)
          resolvedLang = ''
        }

        // Convert hljs class spans → inline style spans for PDF rendering
        const content = hljsToInlineStyles(highlighted)

        // Store resolvedLang in a data attribute so the fence renderer can read it
        const langLabel = resolvedLang || lang || ''
        const langBadge = langLabel
          ? `<div class="code-lang-badge">${escapeHtml(langLabel)}</div>`
          : ''

        // Return starting with <pre so markdown-it does NOT double-wrap
        return `<pre class="code-block-wrapper">${langBadge}<code>${content}</code></pre>`
      },
    })

    // ── Core plugins ────────────────────────────────────
    _md.use(footnotePlugin)
    _md.use(taskListPlugin, { enabled: true, label: true, labelAfter: true })

    // ── Alert containers (:::info, :::warning, etc.) ────
    for (const name of ALERT_CONTAINERS) {
      _md.use(containerPlugin, name, {
        validate (params: string) {
          return params.trim().startsWith(name)
        },
        render (tokens: any[], idx: number) {
          const token = tokens[idx]
          if (token.nesting === 1) {
            const rest = token.info.trim().slice(name.length).trim()
            const title = rest || ALERT_TITLES[name] || name
            const icon = ALERT_ICONS[name] || ''
            return `<div class="md-container md-${name}">\n<div class="md-container-title">${icon} ${escapeHtml(title)}</div>\n`
          }
          return '</div>\n'
        },
      })
    }

    // ── Card container ──────────────────────────────────
    _md.use(containerPlugin, 'card', {
      validate (params: string) {
        return params.trim().startsWith('card')
      },
      render (tokens: any[], idx: number) {
        const token = tokens[idx]
        if (token.nesting === 1) {
          const title = token.info.trim().slice(4).trim()
          const titleHtml = title ? `<div class="md-card-title">${escapeHtml(title)}</div>\n` : ''
          return `<div class="md-card">\n${titleHtml}`
        }
        return '</div>\n'
      },
    })

    // ── Color box containers (:::box-blue, etc.) ────────
    for (const name of COLOR_BOXES) {
      _md.use(containerPlugin, name, {
        validate (params: string) {
          return params.trim().startsWith(name)
        },
        render (tokens: any[], idx: number) {
          const token = tokens[idx]
          if (token.nesting === 1) {
            const title = token.info.trim().slice(name.length).trim()
            const titleHtml = title ? `<div class="md-box-title">${escapeHtml(title)}</div>\n` : ''
            return `<div class="md-box md-${name}">\n${titleHtml}`
          }
          return '</div>\n'
        },
      })
    }

    // ── Details/Summary container ───────────────────────
    _md.use(containerPlugin, 'details', {
      validate (params: string) {
        return params.trim().startsWith('details')
      },
      render (tokens: any[], idx: number) {
        const token = tokens[idx]
        if (token.nesting === 1) {
          const summary = token.info.trim().slice(7).trim() || 'Details'
          return `<div class="md-details">\n<div class="md-details-summary">${escapeHtml(summary)}</div>\n`
        }
        return '</div>\n'
      },
    })

    // ── GitHub Alerts ───────────────────────────────────
    // Transform `> [!NOTE]` style blockquotes after rendering
    _md.core.ruler.after('block', 'github-alerts', (state) => {
      const tokens = state.tokens
      for (let i = 0; i < tokens.length; i++) {
        const openToken = tokens[i]!
        if (openToken.type !== 'blockquote_open') continue

        // Find the first inline token inside this blockquote
        let j = i + 1
        while (j < tokens.length && tokens[j]!.type !== 'blockquote_close') {
          const inlineToken = tokens[j]!
          if (inlineToken.type === 'inline' && inlineToken.content) {
            const match = inlineToken.content.match(/^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]\s*\n?/)
            if (match && match[1]) {
              const alertType = match[1].toLowerCase()
              const icon = ALERT_ICONS[alertType] || ''
              const title = ALERT_TITLES[alertType] || alertType

              // Replace blockquote_open with a div
              openToken.type = 'html_block'
              openToken.content = `<div class="md-container md-${alertType} md-github-alert">\n<div class="md-container-title">${icon} ${title}</div>\n`
              openToken.nesting = 0

              // Remove the alert marker from the inline content
              inlineToken.content = inlineToken.content.slice(match[0].length)

              // Find and replace the blockquote_close
              let k = j + 1
              while (k < tokens.length && tokens[k]!.type !== 'blockquote_close') k++
              if (k < tokens.length) {
                const closeToken = tokens[k]!
                closeToken.type = 'html_block'
                closeToken.content = '</div>\n'
                closeToken.nesting = 0
              }
            }
            break
          }
          j++
        }
      }
    })
  }
  return _md
}

// ── Mermaid rendering ─────────────────────────────────────────────

let _mmdcAvailable: boolean | null = null

/**
 * Check if `mmdc` (mermaid CLI) is available on PATH.
 * Caches the result after first check.
 */
async function isMmdcAvailable (): Promise<boolean> {
  if (_mmdcAvailable !== null) return _mmdcAvailable
  try {
    const proc = Bun.spawn(['which', 'mmdc'], { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    _mmdcAvailable = code === 0
  } catch {
    _mmdcAvailable = false
  }
  return _mmdcAvailable
}

/**
 * Render a mermaid diagram to inline SVG using `mmdc`.
 * Returns the SVG string, or null on failure.
 */
async function renderMermaidBlock (code: string): Promise<string | null> {
  const fs = await import('fs')
  const tmpDir = '/tmp'
  const id = `lynpdf-mmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const inputPath = `${tmpDir}/${id}.mmd`
  const outputPath = `${tmpDir}/${id}.svg`

  try {
    await Bun.write(inputPath, code)
    const proc = Bun.spawn(
      ['mmdc', '-i', inputPath, '-o', outputPath, '-e', 'svg', '--quiet'],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const exitCode = await proc.exited
    if (exitCode !== 0) return null

    const svg = await Bun.file(outputPath).text()
    return svg
  } catch {
    return null
  } finally {
    try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
    try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
  }
}

/**
 * Find all mermaid blocks in HTML and replace them with rendered SVGs.
 * Falls back to styled code blocks if mmdc is not available.
 */
async function processMermaidBlocks (html: string): Promise<string> {
  const available = await isMmdcAvailable()

  // Match mermaid-block divs generated by our highlight function
  const regex = /<div class="mermaid-block" data-mermaid="([^"]*)">[^]*?<\/div>/g
  const matches = [...html.matchAll(regex)]
  if (matches.length === 0) return html

  let result = html
  for (const match of matches) {
    const encoded = match[1]
    if (!encoded) continue
    const mermaidCode = decodeURIComponent(encoded)

    if (available) {
      const svg = await renderMermaidBlock(mermaidCode)
      if (svg) {
        result = result.replace(match[0], `<div class="md-mermaid">${svg}</div>`)
        continue
      }
    }

    // Fallback: styled code block with diagram label
    result = result.replace(
      match[0],
      `<div class="md-mermaid-fallback">`
      + `<div class="md-mermaid-label">📊 Diagram (mermaid)</div>`
      + `<pre class="md-mermaid-code"><code>${escapeHtml(mermaidCode)}</code></pre>`
      + `</div>`
    )
  }

  return result
}

// ── Public API ────────────────────────────────────────────────────

export class MarkdownParser {
  /**
   * Convert a Markdown string to an HTML string (synchronous).
   *
   * By default the result is a complete HTML document with `<html>`, `<head>` (containing
   * a `<style>` block with sensible Markdown defaults), and `<body>`.
   *
   * Note: Mermaid diagrams are NOT rendered in this sync version — they appear as styled
   * code blocks. Use `toHTMLAsync()` for full mermaid rendering.
   *
   * @param markdown  Raw Markdown source
   * @param options   Conversion options
   * @returns         HTML string ready for `PDFCreator.createPDF()`
   */
  static toHTML (markdown: string, options: MarkdownOptions = {}): string {
    const {
      includeDefaultCss = true,
      wrapInDocument = true,
      title = 'Untitled',
    } = options

    const md = getMd()
    const bodyHtml = md.render(markdown)

    if (!wrapInDocument) {
      return bodyHtml
    }

    const cssBlock = includeDefaultCss
      ? `<style>\n${MARKDOWN_DEFAULT_CSS}\n</style>`
      : ''

    return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  ${cssBlock}
</head>
<body>
${bodyHtml}
</body>
</html>`
  }

  /**
   * Convert a Markdown string to an HTML string (asynchronous).
   *
   * Same as `toHTML()` but additionally renders Mermaid diagram blocks
   * to inline SVG via the `mmdc` CLI (if available on PATH).
   *
   * @param markdown  Raw Markdown source
   * @param options   Conversion options
   * @returns         HTML string with rendered diagrams
   */
  static async toHTMLAsync (markdown: string, options: MarkdownOptions = {}): Promise<string> {
    const html = MarkdownParser.toHTML(markdown, options)
    const { renderMermaid = true } = options
    if (!renderMermaid) return html
    return processMermaidBlocks(html)
  }

  /**
   * Detect whether a file path looks like a Markdown file based on extension.
   */
  static isMarkdownFile (filePath: string): boolean {
    return /\.(md|markdown|mdx|mdown|mkd)$/i.test(filePath)
  }
}

/** Minimal HTML entity escaping for attribute-safe strings. */
function escapeHtml (str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
