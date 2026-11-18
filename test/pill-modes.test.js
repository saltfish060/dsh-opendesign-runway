import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Pill text modes.
 *
 * The module below mirrors the mode logic in `client.js` (browser bundle, not
 * importable here) so the naming and fallback rules stay pinned: each single-cycle
 * mode shows its own cycle, a missing cycle says so instead of borrowing another
 * number, and an older build's stored value keeps the user's intent.
 */

const PILL_MODES = Object.freeze(['hour', 'day', 'both', 'none'])
const PILL_MODE_TEXT = Object.freeze({ both: '两个窗口都显示', none: '不显示文字' })

const HOUR = { key: 'h', durationSeconds: 18_000, remainingPct: 64 }
const DAY = { key: 'd', durationSeconds: 604_800, remainingPct: 88 }

function shortCode(entry) {
  const seconds = Number(entry?.durationSeconds)
  if (!Number.isFinite(seconds) || seconds <= 0) return '?'
  const day = 86_400
  const hour = 3_600
  if (seconds % day === 0) return `${seconds / day}d`
  if (seconds % hour === 0) return `${seconds / hour}h`
  return `${Math.round(seconds / hour)}h`
}

function cyclePair(windows) {
  const measured = (Array.isArray(windows) ? windows : [])
    .filter((entry) => typeof entry.remainingPct === 'number')
    .slice()
    .sort((left, right) => (Number(left.durationSeconds) || 0) - (Number(right.durationSeconds) || 0))
  if (measured.length === 0) return { short: null, long: null }
  if (measured.length === 1) return { short: measured[0], long: null }
  return { short: measured[0], long: measured[measured.length - 1] }
}

function migrateMode(stored) {
  if (PILL_MODES.includes(stored)) return stored
  if (stored === 'worst' || stored === 'short') return 'hour'
  if (stored === 'long') return 'day'
  return 'hour'
}

function cycleFor(mode, pair) {
  if (mode === 'day') return pair.long ?? pair.short
  return pair.short ?? pair.long
}

function pillModeLabel(mode, windows) {
  const pair = cyclePair(windows)
  if (mode === 'hour' || mode === 'day') {
    const entry = cycleFor(mode, pair)
    const code = entry === null ? (mode === 'day' ? '7d' : '5h') : shortCode(entry)
    return `仅 ${code} 百分比`
  }
  return PILL_MODE_TEXT[mode] ?? mode
}

test('there is one mode per cycle plus the combined and silent ones', () => {
  assert.deepEqual([...PILL_MODES], ['hour', 'day', 'both', 'none'])
})

test('each single-cycle chip names its own cycle from the reading', () => {
  assert.equal(pillModeLabel('hour', [HOUR, DAY]), '仅 5h 百分比')
  assert.equal(pillModeLabel('day', [HOUR, DAY]), '仅 7d 百分比')
})

test('the chips fall back to 5h/7d when no reading has arrived yet', () => {
  assert.equal(pillModeLabel('hour', []), '仅 5h 百分比')
  assert.equal(pillModeLabel('day', []), '仅 7d 百分比')
})

test('a single window answers for both chips, named by its own length', () => {
  // One 14-day pool: there is no 5h cycle at all, so the hour chip must not
  // pretend to show one.
  const odd = { key: 'x', durationSeconds: 1_209_600, remainingPct: 50 }
  assert.equal(pillModeLabel('hour', [odd]), '仅 14d 百分比')
  assert.equal(pillModeLabel('day', [odd]), '仅 14d 百分比')
})

test('the combined mode is labelled as two windows, not as a percentage', () => {
  assert.equal(pillModeLabel('both', [HOUR, DAY]), '两个窗口都显示')
  assert.equal(pillModeLabel('none', [HOUR, DAY]), '不显示文字')
})

test('an old "worst" choice carries forward to the short cycle', () => {
  assert.equal(migrateMode('worst'), 'hour')
})

test('old short/long names map to their new equivalents', () => {
  assert.equal(migrateMode('short'), 'hour')
  assert.equal(migrateMode('long'), 'day')
})

test('a current value is kept, and garbage falls back to the short cycle', () => {
  assert.equal(migrateMode('day'), 'day')
  assert.equal(migrateMode('nonsense'), 'hour')
  assert.equal(migrateMode(null), 'hour')
})

test('the short cycle is the tighter of two windows, by duration', () => {
  const { short, long } = cyclePair([DAY, HOUR])
  assert.equal(short.key, 'h')
  assert.equal(long.key, 'd')
})

test('a single window has no long cycle to show', () => {
  const { short, long } = cyclePair([HOUR])
  assert.equal(short.key, 'h')
  assert.equal(long, null)
})
