/**
 * Unit Tests: TextMeasurer
 */
import { describe, expect, test } from 'bun:test'
import { TextMeasurer } from '../../src/text/text-measurer'

const FONT_PATH = 'fonts/Sarabun-Regular.ttf'

describe('TextMeasurer', () => {
  let measurer: TextMeasurer

  test('constructor loads font without error', () => {
    measurer = new TextMeasurer(FONT_PATH)
    expect(measurer).toBeDefined()
  })

  test('naturalLineHeightMultiplier is positive', () => {
    measurer = new TextMeasurer(FONT_PATH)
    expect(measurer.naturalLineHeightMultiplier).toBeGreaterThan(0)
  })

  // ── measureWidth ──
  test('measureWidth returns positive value for non-empty text', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const w = measurer.measureWidth('Hello', 14)
    expect(w).toBeGreaterThan(0)
  })

  test('measureWidth returns 0 for empty text', () => {
    measurer = new TextMeasurer(FONT_PATH)
    expect(measurer.measureWidth('', 14)).toBe(0)
  })

  test('measureWidth scales with font size', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const w14 = measurer.measureWidth('Test', 14)
    const w28 = measurer.measureWidth('Test', 28)
    // Doubling font size should roughly double width
    expect(w28).toBeGreaterThan(w14 * 1.5)
    expect(w28).toBeLessThan(w14 * 2.5)
  })

  test('measureWidth works for Thai text', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const w = measurer.measureWidth('สวัสดีครับ', 14)
    expect(w).toBeGreaterThan(0)
  })

  test('measureWidth works for mixed Thai+English', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const wThai = measurer.measureWidth('สวัสดี', 14)
    const wEng = measurer.measureWidth('Hello', 14)
    const wMixed = measurer.measureWidth('สวัสดี Hello', 14)
    // Mixed should be wider than either alone
    expect(wMixed).toBeGreaterThan(wThai)
    expect(wMixed).toBeGreaterThan(wEng)
  })

  test('measureWidth for text with diacritics (สระลอย/วรรณยุกต์)', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const w1 = measurer.measureWidth('น้ำ', 14)
    const w2 = measurer.measureWidth('ผู้', 14)
    const w3 = measurer.measureWidth('ป่า', 14)
    expect(w1).toBeGreaterThan(0)
    expect(w2).toBeGreaterThan(0)
    expect(w3).toBeGreaterThan(0)
  })

  // ── measureHeight ──
  test('measureHeight returns positive value', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const h = measurer.measureHeight(14)
    expect(h).toBeGreaterThan(0)
  })

  test('measureHeight scales with font size', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const h14 = measurer.measureHeight(14)
    const h28 = measurer.measureHeight(28)
    expect(h28).toBeGreaterThan(h14)
  })

  test('measureHeight respects lineHeightMultiplier', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const h1 = measurer.measureHeight(14, 1.0)
    const h2 = measurer.measureHeight(14, 2.0)
    expect(h2).toBeGreaterThan(h1)
  })

  // ── calcLineGap ──
  test('calcLineGap returns non-negative value', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const gap = measurer.calcLineGap(14, 1.5)
    expect(gap).toBeGreaterThanOrEqual(0)
  })

  // ── countLines ──
  test('countLines returns 1 for short text', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const lines = measurer.countLines('Hi', 14, 500)
    expect(lines).toBe(1)
  })

  test('countLines returns >1 for long text in narrow container', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const text = 'This is a very long text that should wrap to multiple lines when placed in a narrow container.'
    const lines = measurer.countLines(text, 14, 100)
    expect(lines).toBeGreaterThan(1)
  })

  test('countLines handles Thai text word wrapping', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const text = 'ประเทศไทยเป็นประเทศที่ตั้งอยู่ในภูมิภาคเอเชียตะวันออกเฉียงใต้มีพรมแดนติดต่อกับประเทศเพื่อนบ้าน'
    const lines = measurer.countLines(text, 14, 200)
    expect(lines).toBeGreaterThan(1)
  })

  test('countLines returns 1 for empty text', () => {
    measurer = new TextMeasurer(FONT_PATH)
    const lines = measurer.countLines('', 14, 500)
    expect(lines).toBeGreaterThanOrEqual(1)
  })
})
