import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * The settings page readout.
 *
 * A page holding only switches tells a reader nothing about their account, so the
 * numbers sit at the top of it. These tests pin the decisions that render makes:
 * which figures appear, and which of them are allowed to be missing.
 *
 * The functions mirror `client.js`, which runs in the browser bundle and cannot be
 * imported here.
 */

/** Mirrors the `healthy`/`walletAmount`/`tokensToday` derivation. */
function readoutOf(snapshot) {
  const reading = snapshot?.reading ?? null
  const healthy = reading?.status === 'ok'
  const walletAmount = healthy && typeof reading?.money?.amount === 'number' ? reading.money.amount : null
  const usage = healthy ? (reading?.usage ?? null) : null
  const tokensToday = usage !== null && usage.today !== undefined
    ? (usage.today.input ?? 0) + (usage.today.output ?? 0)
    : null
  return { reading, healthy, walletAmount, tokensToday }
}

const OK_READING = {
  status: 'ok',
  tier: 'go',
  money: { amount: 1.0998, currency: 'USD' },
  windows: [{ key: 'h', label: '5 小时', remainingPct: 99 }],
  usage: { today: { input: 500, output: 250 } },
  queriedAt: 1_700_000_000_000,
}

test('a healthy reading contributes all three figures', () => {
  const out = readoutOf({ reading: OK_READING })
  assert.equal(out.healthy, true)
  assert.equal(out.walletAmount, 1.0998)
  assert.equal(out.tokensToday, 750)
})

test('today\'s tokens are input plus output, excluding cache reads', () => {
  const reading = { ...OK_READING, usage: { today: { input: 100, output: 40, cacheRead: 9_000 } } }
  assert.equal(readoutOf({ reading }).tokensToday, 140)
})

test('a reading that failed contributes no figures at all', () => {
  const reading = { status: 'no-credential', message: '没有可用的 OpenDesign 凭据。' }
  const out = readoutOf({ reading })
  assert.equal(out.healthy, false)
  assert.equal(out.walletAmount, null)
  assert.equal(out.tokensToday, null)
})

test('no snapshot yet is not a failure, it is simply empty', () => {
  const out = readoutOf(null)
  assert.equal(out.healthy, false)
  assert.equal(out.reading, null)
})

test('a reading without usage leaves the token row out, not at zero', () => {
  const reading = { ...OK_READING, usage: null }
  assert.equal(readoutOf({ reading }).tokensToday, null)
})

test('missing token counts count as zero rather than blanking the row', () => {
  const reading = { ...OK_READING, usage: { today: { output: 120 } } }
  assert.equal(readoutOf({ reading }).tokensToday, 120)
})

/** Mirrors the timestamp choice for the "updated at" row. */
function readAtOf(snapshot) {
  const reading = snapshot?.reading ?? null
  const iso = typeof reading?.queriedAt === 'number'
    ? new Date(reading.queriedAt).toISOString()
    : (typeof snapshot?.asOf === 'number' ? new Date(snapshot.asOf).toISOString() : null)
  return iso
}

test('the time shown is when the reading was taken, not when the page asked', () => {
  // A cached reading keeps its original timestamp; using asOf would claim it was
  // fresh on every poll.
  const snapshot = { reading: { queriedAt: 1_700_000_000_000 }, asOf: 1_700_003_600_000 }
  assert.equal(readAtOf(snapshot), new Date(1_700_000_000_000).toISOString())
})

test('a reading without a timestamp falls back to the snapshot time', () => {
  const snapshot = { reading: {}, asOf: 1_700_000_000_000 }
  assert.equal(readAtOf(snapshot), new Date(1_700_000_000_000).toISOString())
})

test('neither timestamp means the row is omitted', () => {
  assert.equal(readAtOf({ reading: {} }), null)
  assert.equal(readAtOf(null), null)
})

/** Mirrors the polling interval choice. */
const POLL_MS = 30_000
const LOGIN_POLL_MS = 1_500

function intervalFor(snapshot) {
  const state = snapshot?.login?.state
  return state === 'starting' || state === 'pending' ? LOGIN_POLL_MS : POLL_MS
}

test('polling is slow unless a sign-in is in flight', () => {
  assert.equal(intervalFor({ login: { state: 'idle' } }), POLL_MS)
  assert.equal(intervalFor({}), POLL_MS)
})

test('a running sign-in speeds the cycle up', () => {
  assert.equal(intervalFor({ login: { state: 'starting' } }), LOGIN_POLL_MS)
  assert.equal(intervalFor({ login: { state: 'pending' } }), LOGIN_POLL_MS)
})
