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
