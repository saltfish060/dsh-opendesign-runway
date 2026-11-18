import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Wallet balance on the browser-session channel.
 *
 * A Design Plan account still holds wallet money: the plan pays first, and the
 * wallet pays once the windows run dry. The cookie channel used to leave the
 * balance unset, which hid it from exactly the reader whose windows are nearly
 * empty.
 *
 * `read()` is an HTTP-owning function and cannot run here, so this pins the two
 * decisions it makes: the balance is present, and the granted credit's expiry
 * travels with it.
 */

/** Mirrors the `money` construction in `read()` after the wallet read. */
function moneyOf({ amount, windows, expiresAt }) {
  if (typeof amount !== 'number') return null
  return {
    amount,
    currency: 'USD',
    kind: windows.length > 0 ? 'plan' : 'wallet',
    expiresAt: expiresAt ?? null,
  }
}

test('a plan account reports its wallet amount and stays labelled plan', () => {
  const money = moneyOf({ amount: 1.0998, windows: [{ key: 'h' }], expiresAt: null })
  assert.equal(money.amount, 1.0998)
  assert.equal(money.kind, 'plan')
})

test('an account without windows is a wallet account', () => {
  assert.equal(moneyOf({ amount: 1.0998, windows: [], expiresAt: null }).kind, 'wallet')
})

test('the granted credit expiry travels with the balance', () => {
  const money = moneyOf({ amount: 1.0998, windows: [], expiresAt: '2026-11-20T06:41:27.366Z' })
  assert.equal(money.expiresAt, '2026-11-20T06:41:27.366Z')
})

test('a balance that could not be read is null, not zero', () => {
  assert.equal(moneyOf({ amount: null, windows: [], expiresAt: null }), null)
  assert.equal(moneyOf({ amount: undefined, windows: [], expiresAt: null }), null)
})

/** Mirrors the expiry reminder rule in the panel. */
function expiryNotice(iso, now) {
  if (typeof iso !== 'string' || iso === '') return null
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  const hours = (at - now) / 3_600_000
  if (!Number.isFinite(hours) || hours <= 0) return null
  if (hours > 72) return null
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60))
    return { days: 0, text: `${minutes} 分钟后过期` }
  }
  const days = Math.ceil(hours / 24)
  return { days, text: days <= 1 ? '不到 1 天后过期' : `${days} 天后过期` }
}

const NOW = Date.parse('2026-11-18T08:00:00.000Z')

test('an expiry more than three days out says nothing', () => {
  assert.equal(expiryNotice('2026-11-22T09:00:00.000Z', NOW), null)
})

test('an expiry within three days is announced in days', () => {
  assert.equal(expiryNotice('2026-11-20T06:41:27.366Z', NOW).text, '2 天后过期')
})

test('an expiry within a day is announced as under a day', () => {
  assert.equal(expiryNotice('2026-11-19T00:00:00.000Z', NOW).text, '不到 1 天后过期')
})

test('an expiry within the hour is announced in minutes', () => {
  assert.equal(expiryNotice('2026-11-18T08:30:00.000Z', NOW).text, '30 分钟后过期')
})

test('an expiry already past is not announced', () => {
  assert.equal(expiryNotice('2026-11-17T08:00:00.000Z', NOW), null)
})

test('a missing or unparsable expiry is not announced', () => {
  assert.equal(expiryNotice(null, NOW), null)
  assert.equal(expiryNotice('', NOW), null)
  assert.equal(expiryNotice('not a date', NOW), null)
})
