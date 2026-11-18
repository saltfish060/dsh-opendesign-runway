import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from '../lib/store.js'
import { call, describeError, echo } from '../lib/http.js'
import { controlKeyFromDisk, amrConfigPath, maskCookie } from '../lib/credentials.js'

test('call() classifies a transport failure without throwing', async () => {
  const result = await call({ url: 'https://example.invalid/api', timeoutMs: 200 })
  assert.equal(result.status, null)
  assert.equal(result.kind, 'network-error')
  assert.ok(result.error)
})

test('call() rejects non-https URLs instead of guessing a scheme', async () => {
  const result = await call({ url: 'http://example.invalid/api', timeoutMs: 200 })
  assert.equal(result.kind, 'network-error')
  assert.match(String(result.error?.message), /https/)
})

test('describeError keeps one line and echo caps the body', () => {
  assert.equal(describeError(new Error('first\nsecond')), 'first')
  assert.ok(echo('x'.repeat(1000)).length <= 401)
  assert.equal(echo('短').endsWith('…'), false)
})

test('store: a single reading cannot yield a burn rate', () => {
  const store = createStore({ now: () => 1_000 })
  store.recordSuccess('p', { status: 'ok', money: { amount: 10 }, queriedAt: 1_000 })
  assert.equal(store.burnRate('p'), null)
})

test('store: two readings 60s apart produce a daily rate', () => {
  let clock = 0
  const store = createStore({ now: () => clock })
  clock = 0
  store.recordSuccess('p', { status: 'ok', money: { amount: 10 }, queriedAt: 0 })
  clock = 60_000
  store.recordSuccess('p', { status: 'ok', money: { amount: 9 }, queriedAt: 60_000 })
  const rate = store.burnRate('p')
  assert.ok(rate !== null)
  assert.equal(Math.round(rate.perDay), 1440)
})

test('store: a top-up is not counted as a burn rate', () => {
  let clock = 0
  const store = createStore({ now: () => clock })
  store.recordSuccess('p', { status: 'ok', money: { amount: 10 }, queriedAt: 0 })
  clock = 60_000
  store.recordSuccess('p', { status: 'ok', money: { amount: 20 }, queriedAt: 60_000 })
  assert.equal(store.burnRate('p'), null)
})

test('store: the refresh floor holds until minIntervalMs elapses', () => {
  let clock = 0
  const store = createStore({ minIntervalMs: 60_000, now: () => clock })
  store.recordSuccess('p', { status: 'ok', money: { amount: 10 }, queriedAt: 0 })
  clock = 30_000
  assert.equal(store.mayAutoRefresh('p'), false)
  clock = 61_000
  assert.equal(store.mayAutoRefresh('p'), true)
})

test('store: a failure arms the cooldown and a forced refresh clears it', () => {
  let clock = 0
  const store = createStore({ cooldownMs: 300_000, now: () => clock })
  store.recordFailure('p', { status: 'http-error', queriedAt: 0 })
  clock = 10_000
  assert.equal(store.mayAutoRefresh('p'), false)
  store.clearCooldown('p')
  assert.equal(store.mayAutoRefresh('p'), true)
})

test('store: concurrent callers share one request', async () => {
  const store = createStore()
  let runs = 0
  const run = async () => { runs += 1; return 'value' }
  const [first, second] = await Promise.all([store.coalesce('p', run), store.coalesce('p', run)])
  assert.equal(first, 'value')
  assert.equal(second, 'value')
  assert.equal(runs, 1)
})

test('AMR config is resolved the way the vendor CLI resolves it', () => {
  assert.equal(amrConfigPath({ AMR_HOME: 'C:\\custom' }), 'C:\\custom\\config.json')
  assert.ok(amrConfigPath({}).endsWith('config.json'))
})

test('controlKeyFromDisk reports a missing file instead of throwing', () => {
  const result = controlKeyFromDisk({ AMR_HOME: 'C:\\definitely\\not\\here' }, () => {
    const error = new Error('missing')
    error.code = 'ENOENT'
    throw error
  })
  assert.equal(result.ok, false)
  assert.match(String(result.reason), /没有/)
})

test('controlKeyFromDisk picks the only profile when the named one is absent', () => {
  const config = JSON.stringify({ profiles: { prod: { controlKey: 'vela_ctrl_test1234', apiUrl: 'https://api.example' } } })
  const result = controlKeyFromDisk({ AMR_HOME: '' , OPEN_DESIGN_AMR_PROFILE: 'nope' }, () => config)
  assert.equal(result.ok, true)
  assert.equal(result.controlKey, 'vela_ctrl_test1234')
  assert.equal(result.apiUrl, 'https://api.example')
})

test('controlKeyFromDisk refuses to choose between two profiles', () => {
  const config = JSON.stringify({ profiles: { prod: { controlKey: 'a' }, other: { controlKey: 'b' } } })
  const result = controlKeyFromDisk({ OPEN_DESIGN_AMR_PROFILE: 'missing' }, () => config)
  assert.equal(result.ok, false)
  assert.match(String(result.reason), /现有/)
})

test('maskCookie exposes only the tail', () => {
  assert.deepEqual(maskCookie(null), { set: false, tail: '' })
  assert.deepEqual(maskCookie('session=abcdefgh7890'), { set: true, tail: '7890' })
})
