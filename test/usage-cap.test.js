import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeUsage, parseUsageRecord, readUsageRecords } from '../adapters/opendesign.js'

/**
 * The panel shows today's token burn and up to twenty recent calls. Paging is
 * capped at two pages because deeper paging adds latency and invites the
 * vendor's rate limiter for a figure nobody scrolls to.
 */

const ENTRY = {
  createdAt: '2026-11-17T11:31:16.789Z',
  model: 'm',
  listChargedUsd: '0.001',
  amountUsd: '0',
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 500,
}

test('twenty recent calls is a hard ceiling however many records exist', () => {
  const many = Array.from({ length: 50 }, (_, index) => parseUsageRecord({
    ...ENTRY,
    createdAt: `2026-11-17T${String(10 + (index % 10)).padStart(2, '0')}:00:00.000Z`,
  }))
  const summary = summarizeUsage(many)
  assert.equal(summary.recent.length, 20)
  assert.equal(summary.today.requests, 50)
})

test('the usage figure counts only what was actually sent', () => {
  const summary = summarizeUsage([parseUsageRecord(ENTRY)])
  assert.equal(summary.today.input + summary.today.output, 110)
  // Cache reads are reported separately and never added to the headline.
  assert.equal(summary.today.cacheRead, 500)
})

test('a failed read reports failure and no usage, so the panel shows nothing invented', async () => {
  // An empty cookie reaches no endpoint, which is the fastest honest failure.
  const result = await readUsageRecords({ cookie: '', workspaceId: 'w', timeoutMs: 200, day: '2026-11-17' })
  assert.equal(result.usage, null)
  assert.notEqual(result.failure, null)
  assert.ok(Array.isArray(result.trail))
})


test('recent calls span days while today totals only count the requested day', async () => {
  const entry = (createdAt, model) => ({ ...ENTRY, createdAt, model, initiator: `caller-${model}` })
  const seen = []
  const reply = [
    { entries: [entry('2026-11-18T00:01:00Z', 'today'), entry('2026-11-17T23:59:00Z', 'yesterday')], hasMore: true, nextCursor: 'two' },
    { entries: [entry('2026-11-17T23:58:00Z', 'earlier')], hasMore: false },
  ]
  const result = await readUsageRecords({ cookie: 'fake', workspaceId: 'w', day: '2026-11-18' }, async ({ url }) => {
    seen.push(new URL(url).searchParams.get('cursor'))
    return { ok: true, body: reply.shift() }
  })
  assert.deepEqual(seen, [null, 'two'])
  assert.equal(result.usage.today.requests, 1)
  assert.deepEqual(result.usage.recent.map(({ model }) => model), ['today', 'yesterday', 'earlier'])
  assert.deepEqual(result.usage.recent.map(({ initiator }) => initiator), ['caller-today', 'caller-yesterday', 'caller-earlier'])
})

test('a day without calls still retains the latest historical records', async () => {
  const result = await readUsageRecords({ cookie: 'fake', workspaceId: 'w', day: '2026-11-18' }, async () => ({
    ok: true, body: { entries: [ENTRY] },
  }))
  assert.equal(result.usage.records, 0)
  assert.equal(result.usage.today, undefined)
  assert.equal(result.usage.recent.length, 1)
})
