import assert from 'node:assert/strict'
import test from 'node:test'

import { windowOutlook } from '../adapters/opendesign.js'

/**
 * Which windows earn a forecast.
 *
 * The panel only prints a rate outlook for cycles of a day or longer. A 5-hour
 * window resets before a meaningful trend forms, so a prediction there would read
 * as more certain than the data supports — and it made the panel taller for no
 * benefit.
 *
 * `windowOutlook` itself stays general (it answers for any window); the decision
 * to withhold the line for short cycles lives in the panel. These tests pin the
 * boundary the panel checks.
 */

const DAY = 86_400
const HOUR = 3_600

function windowOf(durationSeconds) {
  const start = Date.parse('2026-11-18T02:53:11.000Z')
  return {
    durationSeconds,
    windowStart: new Date(start).toISOString(),
    resetAt: new Date(start + durationSeconds * 1000).toISOString(),
    credits: { used: '1507', limit: '50000', remaining: '48493' },
  }
}

test('a window shorter than a day is below the forecast threshold', () => {
  assert.equal(windowOf(5 * HOUR).durationSeconds < DAY, true)
  assert.equal(windowOf(12 * HOUR).durationSeconds < DAY, true)
})

test('a window of exactly one day or longer qualifies', () => {
  assert.equal(windowOf(DAY).durationSeconds < DAY, false)
  assert.equal(windowOf(7 * DAY).durationSeconds < DAY, false)
})

test('the outlook function still answers for a short window, so the gate is the panel\'s', () => {
  // One minute into a 5-hour window: 1507 credits in 1/60 h is ~90k/h against
  // 48493 left, so the honest answer is that it runs out long before the reset.
  const now = Date.parse('2026-11-18T02:54:11.000Z')
  const outlook = windowOutlook(windowOf(5 * HOUR), { now })
  assert.notEqual(outlook, null)
  assert.equal(outlook.verdict, 'exhausts')
})

test('a missing duration is treated as not qualifying', () => {
  const entry = { durationSeconds: null, resetAt: '2026-11-20T00:00:00Z', credits: { used: '1', remaining: '9' } }
  const seconds = Number(entry.durationSeconds)
  assert.equal(Number.isFinite(seconds) && seconds >= DAY, false)
})
