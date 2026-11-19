import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import test from 'node:test'

import {
  parseCodingPlan,
  parseSummaryUsage,
  parseSummaryBilling,
  pickWorkspace,
  remainingPercent,
  windowLabel,
  keyIdentity,
  read as readOpenDesign,
  verifySession,
  sourceLine,
} from '../adapters/opendesign.js'

test('remainingPercent uses the exact credit pair', () => {
  assert.equal(remainingPercent('500', '1000'), 50)
  assert.equal(remainingPercent('1000', '1000'), 0)
  assert.equal(remainingPercent('0', '1000'), 100)
  assert.equal(remainingPercent('x', '1000'), null)
  assert.equal(remainingPercent('10', '0'), null)
})

test('windowLabel is derived from the duration, not a table', () => {
  assert.equal(windowLabel(18_000), '5 小时')
  assert.equal(windowLabel(604_800), '7 天')
  assert.equal(windowLabel(null), '额度窗口')
})

test('an empty codingPlan is a real answer, not a parse failure', () => {
  const plan = parseCodingPlan({ workspaceId: 'w', eligible: false, tier: null, windows: [] })
  assert.deepEqual(plan.windows, [])
  assert.equal(plan.tier, null)
})

test('codingPlan windows are sorted shortest first and carry reset time', () => {
  const plan = parseCodingPlan({
    tier: 'pro',
    windows: [
      { policyId: 'week', durationSeconds: 604_800, usedCredits: '150', limitCredits: '1000', resetsAt: '2026-11-20T00:00:00Z' },
      { policyId: 'short', durationSeconds: 18_000, usedCredits: '100', limitCredits: '200' },
    ],
  })
  assert.equal(plan.tier, 'pro')
  assert.equal(plan.windows[0].key, 'short')
  assert.equal(plan.windows[0].remainingPct, 50)
  assert.equal(plan.windows[1].remainingPct, 85)
  assert.equal(plan.windows[1].resetAt, '2026-11-20T00:00:00Z')
})

test('a window with an unreadable credit pair is listed without a percentage', () => {
  const plan = parseCodingPlan({ windows: [{ policyId: 'x', durationSeconds: 3600, limitCredits: '0' }] })
  assert.equal(plan.windows.length, 1)
  assert.equal(plan.windows[0].remainingPct, null)
})

test('summary usage carries today, total and recharged figures', () => {
  // Shape taken from a live GET /api/v1/billing/summary on 2026-11-17.
  const usage = parseSummaryUsage({
    todayConsumedUsd: '0.0000',
    totalConsumedUsd: '0.8336',
    totalRechargedUsd: '0.5000',
    usageCount: 0,
  })
  assert.equal(usage.today, 0)
  assert.equal(usage.total, 0.8336)
  assert.equal(usage.recharged, 0.5)
  assert.equal(usage.usageCount, 0)
})

test('a summary without consumption figures yields null, not zeros', () => {
  assert.equal(parseSummaryUsage({ balanceUsd: '1.00' }), null)
  assert.equal(parseSummaryUsage(null), null)
})

test('summary billing exposes the subscription period when there is one', () => {
  const billing = parseSummaryBilling({
    subscriptionStatus: 'active',
    subscriptionCurrentPeriodStart: '2026-11-01T00:00:00Z',
    subscriptionCurrentPeriodEnd: '2026-12-01T00:00:00Z',
    subscriptionCancelAtPeriodEnd: true,
    membershipTier: 'pro',
  })
  assert.equal(billing.status, 'active')
  assert.equal(billing.periodEnd, '2026-12-01T00:00:00Z')
  assert.equal(billing.cancelAtPeriodEnd, true)
  assert.equal(billing.tier, 'pro')
})

test('a free account has no billing block at all', () => {
  assert.equal(parseSummaryBilling({
    subscriptionStatus: null,
    subscriptionCurrentPeriodEnd: null,
    membershipTier: null,
  }), null)
})

test('pickWorkspace prefers the personal workspace', () => {
  const chosen = pickWorkspace({
    items: [
      { workspaceId: 'team1', workspaceType: 'team' },
      { workspaceId: 'me1', workspaceType: 'personal' },
    ],
  })
  assert.equal(chosen.id, 'me1')
})

test('pickWorkspace tolerates the bare-array spelling and empty bodies', () => {
  assert.equal(pickWorkspace([{ id: 'only' }]).id, 'only')
  assert.equal(pickWorkspace({}), null)
  assert.equal(pickWorkspace(null), null)
})

test('keyIdentity never returns the whole key', () => {
  const identity = keyIdentity('vela_ctrl_secret_tail')
  assert.equal(identity.tail, 'tail')
  assert.equal(JSON.stringify(identity).includes('secret'), false)
})

test('no credential reports no-credential with a skipped trail, never a number', async () => {
  const reading = await readOpenDesign({ source: 'auto', controlKey: null, cookie: null })
  assert.equal(reading.status, 'no-credential')
  assert.equal(reading.money, null)
  assert.equal(reading.windows.length, 0)
  assert.ok(reading.trail.some((entry) => String(entry.result).startsWith('skipped')))
})

test('an unknown source explains itself instead of guessing', async () => {
  const reading = await readOpenDesign({ source: 'weird', controlKey: 'k', cookie: 'c' })
  assert.equal(reading.status, 'no-credential')
  assert.match(String(reading.message), /无法识别/)
})

test('a refused controlKey reports unauthorized, not a network failure', async () => {
  const reading = await readOpenDesign({ source: 'control', controlKey: 'not-a-real-control-key', cookie: null, timeoutMs: 8000 })
  if (reading.status === 'network-error') {
    // Offline machine: the assertion that matters is that no number is invented.
    assert.equal(reading.money, null)
    return
  }
  assert.equal(reading.status, 'unauthorized')
  assert.equal(reading.money, null)
})

test('verifySession treats an unauthenticated body as not signed in', async () => {
  // The live endpoint answers 200 with the literal `null` when there is no
  // session, which must not be read as success.
  const verdict = await verifySession('', 5000)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.session, null)
})

test('sourceLine names the channel and the credential tail', () => {
  const line = sourceLine({
    status: 'ok',
    identity: { label: 'controlKey', tail: 'FVel' },
    channel: 'control',
    endpoint: 'preflight',
  })
  assert.match(line, /controlKey/)
  assert.match(line, /FVel/)
  assert.match(line, /preflight/)
  assert.equal(sourceLine({ status: 'no-credential' }), null)
})


test('cookie subscription dates are read independently of wallet expiration', async (t) => {
  const periodEnd = '2026-12-01T00:00:00Z'
  const expiresAt = '2027-03-01T00:00:00Z'
  let summaryStatus = 200
  const paths = []
  const responseFor = (path) => {
    if (path === '/api/auth/get-session') return { session: { id: 'fake' } }
    if (path.endsWith('/billing/coding-plan-usage')) return { codingPlan: { tier: 'go', windows: [] } }
    if (path.endsWith('/wallet/balance')) return { balanceUsd: '1.10', expiresAt }
    if (path.endsWith('/billing/usage?limit=100')) return { entries: [] }
    if (path === '/api/v1/billing/summary') return {
      subscriptionStatus: 'active', subscriptionCurrentPeriodEnd: periodEnd, subscriptionCancelAtPeriodEnd: true,
    }
    throw new Error(`Unexpected mock request: ${path}`)
  }
  const mock = t.mock.method(https, 'request', (options, callback) => {
    paths.push(options.path)
    assert.equal(options.headers.cookie, 'session=test')
    assert.equal(options.headers.authorization, undefined)
    const body = responseFor(options.path)
    const request = new EventEmitter()
    request.setTimeout = () => {}
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter()
      response.statusCode = options.path.endsWith('/billing/summary') ? summaryStatus : 200
      response.setEncoding = () => {}
      callback(response)
      response.emit('data', JSON.stringify(body))
      response.emit('end')
    })
    return request
  })
  syncBuiltinESMExports()
  try {
    const read = () => readOpenDesign({ source: 'cookie', cookie: 'session=test', workspaceId: 'workspace' })
    const reading = await read()
    assert.equal(reading.status, 'ok')
    assert.equal(reading.periodEnd, periodEnd)
    assert.equal(reading.billing.cancelAtPeriodEnd, true)
    assert.equal(reading.money.expiresAt, expiresAt)
    assert.ok(paths.includes('/api/v1/billing/summary'))
    summaryStatus = 403
    const partial = await read()
    assert.equal(partial.status, 'ok')
    assert.equal(partial.periodEnd, null)
    assert.equal(partial.money.expiresAt, expiresAt)
  } finally {
    mock.mock.restore()
    syncBuiltinESMExports()
  }
})
