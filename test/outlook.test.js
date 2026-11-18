import assert from 'node:assert/strict'
import test from 'node:test'

import { parseCodingPlan, windowOutlook } from '../adapters/opendesign.js'

/**
 * Window outlook: "will this pool run out before it resets".
 *
 * The rate is measured from the window's own anchor, so the answer is a property
 * of the account rather than of how long this process has been running.
 */

/** A 5-hour window with 1507 spent of 50000, started 31 minutes ago. */
function hourWindow(overrides = {}) {
  return {
    key: 'h',
    durationSeconds: 18_000,
    remainingPct: 97,
    resetAt: '2026-11-18T07:53:11.000Z',
    windowStart: '2026-11-18T02:53:11.000Z',
    credits: { used: '1507', limit: '50000', remaining: '48493' },
    ...overrides,
  }
}

const NOW = Date.parse('2026-11-18T03:24:11.000Z') // 31 min in, 4.48h to reset

test('a slow burn is reported as surviving until the reset', () => {
  const outlook = windowOutlook(hourWindow(), { now: NOW })
  assert.equal(outlook.verdict, 'survives')
  assert.ok(outlook.hoursToExhaust > outlook.hoursToReset)
  assert.equal(Math.round(outlook.perHour), 2917)
})

test('a fast burn is reported as exhausting before the reset', () => {
  const outlook = windowOutlook(
    hourWindow({ credits: { used: '49000', limit: '50000', remaining: '1000' } }),
    { now: NOW },
  )
  assert.equal(outlook.verdict, 'exhausts')
  assert.ok(outlook.hoursToExhaust < outlook.hoursToReset)
})

test('an untouched window is idle, not "never runs out"', () => {
  const outlook = windowOutlook(
    hourWindow({ credits: { used: '0', limit: '50000', remaining: '50000' } }),
    { now: NOW },
  )
  assert.equal(outlook.verdict, 'idle')
  assert.equal(outlook.perHour, 0)
  // No rate exists, so no exhaustion estimate is invented.
  assert.equal(outlook.hoursToExhaust, null)
})

test('an empty pool exhausts immediately without dividing by zero', () => {
  const outlook = windowOutlook(
    hourWindow({ credits: { used: '50000', limit: '50000', remaining: '0' } }),
    { now: NOW },
  )
  assert.equal(outlook.verdict, 'exhausts')
  assert.equal(outlook.hoursToExhaust, 0)
  assert.ok(Number.isFinite(outlook.perHour))
})

test('a missing windowStart is derived from reset minus duration', () => {
  const outlook = windowOutlook(hourWindow({ windowStart: null }), { now: NOW })
  assert.equal(outlook.anchor, 'derived')
  // 5h window ending 07:53 starts at 02:53 either way.
  assert.equal(Math.round(outlook.perHour), 2917)
})

test('without an anchor or a duration there is no answer', () => {
  assert.equal(windowOutlook(hourWindow({ windowStart: null, durationSeconds: null }), { now: NOW }), null)
})

test('a window that already reset yields no answer', () => {
  const past = hourWindow({ resetAt: '2026-11-18T01:00:00.000Z' })
  assert.equal(windowOutlook(past, { now: NOW }), null)
})

test('a window that has not started yet yields no answer', () => {
  const future = hourWindow({
    windowStart: '2026-11-18T05:00:00.000Z',
    resetAt: '2026-11-18T10:00:00.000Z',
  })
  assert.equal(windowOutlook(future, { now: NOW }), null)
})

test('a window without credit counts yields no answer instead of a guess', () => {
  assert.equal(windowOutlook(hourWindow({ credits: {} }), { now: NOW }), null)
  assert.equal(windowOutlook(hourWindow({ credits: undefined }), { now: NOW }), null)
})

test('nothing at all is handled without throwing', () => {
  assert.equal(windowOutlook(null), null)
  assert.equal(windowOutlook(undefined), null)
  assert.equal(windowOutlook({}), null)
})

test('parsing keeps the exact credit strings and the window anchor', () => {
  const plan = parseCodingPlan({
    windows: [{
      policyId: 'h',
      durationSeconds: 18_000,
      usedCredits: '1507',
      limitCredits: '50000',
      remainingCredits: '48493',
      windowStart: '2026-11-18T02:53:11.000Z',
      resetsAt: '2026-11-18T07:53:11.000Z',
    }],
  })
  const entry = plan.windows[0]
  assert.deepEqual(entry.credits, { used: '1507', limit: '50000', remaining: '48493' })
  assert.equal(entry.windowStart, '2026-11-18T02:53:11.000Z')
  assert.equal(entry.remainingPct, 97)
})

test('a pool beyond 2^53 keeps its exact value as a string', () => {
  const huge = '9007199254740993' // 2^53 + 1
  const plan = parseCodingPlan({
    windows: [{ policyId: 'h', durationSeconds: 18_000, usedCredits: '1', limitCredits: huge, remainingCredits: huge }],
  })
  assert.equal(plan.windows[0].credits.limit, huge)
  assert.equal(plan.windows[0].credits.remaining, huge)
})

test('a window missing remainingCredits derives it from the other two', () => {
  const plan = parseCodingPlan({
    windows: [{ policyId: 'h', durationSeconds: 18_000, usedCredits: '1507', limitCredits: '50000' }],
  })
  assert.equal(plan.windows[0].credits.remaining, '48493')
})
