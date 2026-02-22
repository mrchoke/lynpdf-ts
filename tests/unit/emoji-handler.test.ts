/**
 * Unit Tests: Emoji Handler
 */
import { describe, expect, test } from 'bun:test'
import { hasEmoji, parseEmojiRuns } from '../../src/text/emoji-handler'

describe('Emoji Handler', () => {
  // ── hasEmoji ──
  describe('hasEmoji', () => {
    test('returns true for text with emoji', () => {
      expect(hasEmoji('Hello 😀')).toBe(true)
    })

    test('returns true for flag emoji', () => {
      expect(hasEmoji('🇹🇭 Thailand')).toBe(true)
    })

    test('returns false for plain text', () => {
      expect(hasEmoji('Hello World')).toBe(false)
    })

    test('returns false for Thai text without emoji', () => {
      expect(hasEmoji('สวัสดีครับ')).toBe(false)
    })

    test('returns false for empty string', () => {
      expect(hasEmoji('')).toBe(false)
    })

    test('returns true for emoji-only text', () => {
      expect(hasEmoji('😀😂🥰')).toBe(true)
    })

    test('returns true for emoji with skin tone', () => {
      expect(hasEmoji('👋🏻')).toBe(true)
    })
  })

  // ── parseEmojiRuns ──
  describe('parseEmojiRuns', () => {
    test('returns text-only run for plain text', async () => {
      const runs = await parseEmojiRuns('Hello World')
      expect(runs.length).toBe(1)
      expect(runs[0].type).toBe('text')
      expect(runs[0].text).toBe('Hello World')
    })

    test('splits text and emoji into runs', async () => {
      const runs = await parseEmojiRuns('Hi 👋 there')
      expect(runs.length).toBe(3)
      expect(runs[0].type).toBe('text')
      expect(runs[1].type).toBe('emoji')
      expect(runs[2].type).toBe('text')
    })

    test('handles emoji at start of text', async () => {
      const runs = await parseEmojiRuns('😀 Hello')
      expect(runs[0].type).toBe('emoji')
      expect(runs.length).toBeGreaterThanOrEqual(2)
    })

    test('handles emoji at end of text', async () => {
      const runs = await parseEmojiRuns('Hello 😀')
      const lastRun = runs[runs.length - 1]
      expect(lastRun.type).toBe('emoji')
    })

    test('handles multiple consecutive emoji', async () => {
      const runs = await parseEmojiRuns('😀😂🥰')
      const emojiRuns = runs.filter((r) => r.type === 'emoji')
      expect(emojiRuns.length).toBeGreaterThanOrEqual(1)
    })

    test('emoji runs have pngPath', async () => {
      const runs = await parseEmojiRuns('Test 😀 emoji')
      const emojiRun = runs.find((r) => r.type === 'emoji')
      expect(emojiRun?.pngPath).toBeDefined()
      expect(emojiRun?.pngPath).toContain('twemoji')
    })

    test('handles empty string', async () => {
      const runs = await parseEmojiRuns('')
      expect(runs.length).toBeLessThanOrEqual(1)
    })

    test('handles Thai text with emoji', async () => {
      const runs = await parseEmojiRuns('สวัสดี 🇹🇭')
      expect(runs.length).toBeGreaterThanOrEqual(2)
      const hasEmojiRun = runs.some((r) => r.type === 'emoji')
      expect(hasEmojiRun).toBe(true)
    })
  })
})
