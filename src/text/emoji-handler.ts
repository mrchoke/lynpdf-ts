import { parse as twemojiParse } from '@twemoji/parser'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Emoji renderer — replaces emoji characters with Twemoji PNG images
 * for full-color emoji support in PDFs.
 */

export interface EmojiMatch {
  /** Start index in the original string */
  start: number
  /** End index in the original string */
  end: number
  /** The emoji character(s) */
  text: string
  /** Local file path to the PNG (after download/cache) */
  pngPath: string
}

export interface TextRun {
  type: 'text' | 'emoji'
  text: string
  /** Only for emoji runs */
  pngPath?: string
}

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72'
const CACHE_DIR = path.join(process.cwd(), 'cache', 'twemoji')
/** Max milliseconds to wait for a single emoji PNG from the CDN. */
const FETCH_TIMEOUT_MS = 5000
/** Max concurrent downloads (avoid hammering CDN / OS socket limits). */
const DOWNLOAD_CONCURRENCY = 8

/** Ensure cache directory exists */
function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
  }
}

/**
 * Convert an emoji string to its Twemoji codepoint filename.
 * e.g., '😀' → '1f600', '👨‍💻' → '1f468-200d-1f4bb'
 */
function emojiToCodepoint(emoji: string): string {
  const codepoints: string[] = []
  for (const char of emoji) {
    const cp = char.codePointAt(0)
    if (cp !== undefined && cp !== 0xfe0f) {
      // Skip variation selector-16 (most Twemoji files don't include it)
      codepoints.push(cp.toString(16))
    }
  }
  return codepoints.join('-')
}

/**
 * Download a Twemoji PNG from CDN and cache it locally.
 * Returns the local file path, or null if download fails.
 */
async function downloadEmoji(codepoint: string): Promise<string | null> {
  ensureCacheDir()
  const localPath = path.join(CACHE_DIR, `${codepoint}.png`)

  // Check cache first
  if (fs.existsSync(localPath)) {
    return localPath
  }

  const url = `${CDN_BASE}/${codepoint}.png`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      // Try with fe0f included (some emoji need it)
      const urlWithFe0f = `${CDN_BASE}/${codepoint}-fe0f.png`
      const controller2 = new AbortController()
      const timer2 = setTimeout(() => controller2.abort(), FETCH_TIMEOUT_MS)
      let response2: Response
      try {
        response2 = await fetch(urlWithFe0f, { signal: controller2.signal })
      } finally {
        clearTimeout(timer2)
      }
      if (!response2.ok) {
        console.warn(`Emoji not found: ${codepoint} (${url})`)
        return null
      }
      const buffer = Buffer.from(await response2.arrayBuffer())
      fs.writeFileSync(localPath, buffer)
      return localPath
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(localPath, buffer)
    return localPath
  } catch (e) {
    console.warn(`Failed to download emoji ${codepoint}: ${e}`)
    return null
  }
}

/**
 * Parse a text string and split it into text runs and emoji runs.
 * Downloads any missing emoji PNGs from the Twemoji CDN.
 */
export async function parseEmojiRuns(text: string): Promise<TextRun[]> {
  const entities = twemojiParse(text)
  if (entities.length === 0) {
    return [{ type: 'text', text }]
  }

  const runs: TextRun[] = []
  let lastIndex = 0

  for (const entity of entities) {
    // Add text before this emoji
    if (entity.indices[0] > lastIndex) {
      runs.push({ type: 'text', text: text.substring(lastIndex, entity.indices[0]) })
    }

    // Download the emoji PNG
    const codepoint = emojiToCodepoint(entity.text)
    const pngPath = await downloadEmoji(codepoint)

    if (pngPath) {
      runs.push({ type: 'emoji', text: entity.text, pngPath })
    } else {
      // Fallback: render as text (monochrome NotoEmoji)
      runs.push({ type: 'text', text: entity.text })
    }

    lastIndex = entity.indices[1]
  }

  // Add remaining text after last emoji
  if (lastIndex < text.length) {
    runs.push({ type: 'text', text: text.substring(lastIndex) })
  }

  return runs
}

/**
 * Pre-download all emoji found in a set of texts.
 * Call this before rendering to ensure all PNGs are cached.
 */
export async function preloadEmoji(texts: string[]): Promise<void> {
  const allEmoji = new Set<string>()

  for (const text of texts) {
    const entities = twemojiParse(text)
    for (const entity of entities) {
      allEmoji.add(emojiToCodepoint(entity.text))
    }
  }

  if (allEmoji.size === 0) return

  // Only download what is not yet in the cache
  ensureCacheDir()
  const missing = Array.from(allEmoji).filter(cp => !fs.existsSync(path.join(CACHE_DIR, `${cp}.png`)))
  if (missing.length === 0) return

  console.log(`Downloading ${missing.length} Twemoji PNG(s)...`)
  for (let i = 0; i < missing.length; i += DOWNLOAD_CONCURRENCY) {
    const batch = missing.slice(i, i + DOWNLOAD_CONCURRENCY)
    await Promise.all(batch.map(cp => downloadEmoji(cp)))
  }
}

/**
 * Check if a text string contains any emoji.
 */
export function hasEmoji(text: string): boolean {
  return twemojiParse(text).length > 0
}
