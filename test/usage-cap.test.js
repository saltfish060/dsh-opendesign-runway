import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeUsage, parseUsageRecord, readUsageRecords } from '../adapters/opendesign.js'

/**
 * The panel shows today's token burn and exactly two recent calls. Paging is
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

test('two recent calls is a hard ceiling however many records exist', () => {
  const many = Array.from({ length: 50 }, (_, index) => parseUsageRecord({
    ...ENTRY,
    createdAt: `2026-11-17T${String(10 + (index % 10)).padStart(2, '0')}:00:00.000Z`,
  }))
  const summary = summarizeUsage(many)
  assert.equal(summary.recent.length, 2)
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
