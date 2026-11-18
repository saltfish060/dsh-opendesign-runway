import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Bar colour thresholds.
 *
 * Mirrored from `client.js` (browser bundle, not importable here). A bar that
 * stays green until 30% reads as "no signal" for most of its life; half gone is
 * already worth a colour.
 */
function toneClass(pct) {
  if (pct === null) return 'is-ok'
  if (pct <= 20) return 'is-low'
  if (pct <= 50) return 'is-warn'
  return 'is-ok'
}

test('a healthy window stays green', () => {
  assert.equal(toneClass(100), 'is-ok')
  assert.equal(toneClass(51), 'is-ok')
})

test('half gone is already a warning', () => {
  assert.equal(toneClass(50), 'is-warn')
  assert.equal(toneClass(21), 'is-warn')
})

test('the last fifth is an error tone', () => {
  assert.equal(toneClass(20), 'is-low')
  assert.equal(toneClass(0), 'is-low')
})

test('an unreadable percentage falls back to the neutral tone', () => {
  assert.equal(toneClass(null), 'is-ok')
})
