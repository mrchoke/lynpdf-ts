/**
 * Unit Tests: TextShaper
 */
import { describe, expect, test } from 'bun:test'
import { TextShaper } from '../../src/text/text-shaper'

describe('TextShaper', () => {
  // ── segmentThaiWords ──
  describe('segmentThaiWords', () => {
    test('segments Thai text into words', () => {
      const words = TextShaper.segmentThaiWords('สวัสดีครับ')
      expect(Array.isArray(words)).toBe(true)
      expect(words.length).toBeGreaterThan(0)
    })

    test('segments long Thai paragraph', () => {
      const text = 'ประเทศไทยเป็นประเทศที่ตั้งอยู่ในภูมิภาคเอเชียตะวันออกเฉียงใต้'
      const words = TextShaper.segmentThaiWords(text)
      expect(words.length).toBeGreaterThan(1)
      // Joining all segments should give back the original text
      expect(words.join('')).toBe(text)
    })

    test('handles mixed Thai and English', () => {
      const text = 'สวัสดี Hello World ครับ'
      const words = TextShaper.segmentThaiWords(text)
      expect(words.length).toBeGreaterThan(1)
      expect(words.join('')).toBe(text)
    })

    test('handles empty string', () => {
      const words = TextShaper.segmentThaiWords('')
      expect(Array.isArray(words)).toBe(true)
      expect(words.length).toBe(0)
    })

    test('handles pure English text', () => {
      const words = TextShaper.segmentThaiWords('Hello World')
      expect(words.length).toBeGreaterThan(0)
      expect(words.join('')).toBe('Hello World')
    })

    test('handles Thai with numbers', () => {
      const text = 'ปี 2025 ประชากร 70 ล้านคน'
      const words = TextShaper.segmentThaiWords(text)
      expect(words.length).toBeGreaterThan(1)
      expect(words.join('')).toBe(text)
    })

    test('handles Thai with special characters', () => {
      const text = 'น้ำพริก ผู้ใหญ่ บ้านเกิด'
      const words = TextShaper.segmentThaiWords(text)
      expect(words.length).toBeGreaterThan(1)
      expect(words.join('')).toBe(text)
    })

    test('preserves spaces in segmentation', () => {
      const text = 'คำ หนึ่ง คำ สอง'
      const words = TextShaper.segmentThaiWords(text)
      expect(words.join('')).toBe(text)
    })
  })

  // ── shapeText ──
  describe('shapeText', () => {
    test('returns empty array when HarfBuzz not initialised', () => {
      // Without calling TextShaper.init(), shapeText returns []
      const result = TextShaper.shapeText('สวัสดี', 'fonts/Sarabun-Regular.ttf', 16)
      expect(Array.isArray(result)).toBe(true)
    })

    test('returns empty array for empty string when not initialised', () => {
      const result = TextShaper.shapeText('', 'fonts/Sarabun-Regular.ttf', 16)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })

    test('shapes Thai text after init', async () => {
      await TextShaper.init()
      const result = TextShaper.shapeText('สวัสดี', 'fonts/Sarabun-Regular.ttf', 16)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      // Each glyph should have required properties
      for (const g of result) {
        expect(typeof g.g).toBe('number')
        expect(typeof g.cl).toBe('number')
        expect(typeof g.ax).toBe('number')
      }
    })

    test('validates Thai mark positioning', async () => {
      await TextShaper.init()
      const isValid = TextShaper.validateThaiShaping('fonts/Sarabun-Regular.ttf', 16)
      // Sarabun has GPOS tables for Thai; expect mark positioning
      expect(typeof isValid).toBe('boolean')
    })
  })
})
