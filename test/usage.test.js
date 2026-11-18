import assert from 'node:assert/strict'
import test from 'node:test'

import { parseUsageRecord, summarizeUsage } from '../adapters/opendesign.js'
import { trailEntry } from '../lib/http.js'

/** A record shaped exactly like a live `billing/usage` entry (2026-11-17). */
const LIVE_ENTRY = {
  id: 'workspace-usage:f5b6eb7e',
  type: 'model_usage',
  amountUsd: '-0.0000',
  balanceImpact: 'debit',
  detail: 'deepseek-v4.1-flash',
  initiator: '3mber',
  runtime: 'deepseek-v4.1-flash',
  createdAt: '2026-11-17T11:31:16.789Z',
  consumedAt: '2026-11-17T11:31:16.789Z',
  listChargedUsd: '0.0039',
  listChargeCredits: '39',
  chargeCredits: '0',
  model: 'deepseek-v4.1-flash',
  inputTokens: 557694,
  outputTokens: 163,
  cacheReadTokens: 556672,
  cacheWriteTokens: null,
  usageType: 'design_plan',
  designPlanContribution: { multiplier: 0.5, amountUsd: '0.0020' },
  billingMultiplier: 1,
}

test('a usage record separates list price from wallet charge', () => {
  const record = parseUsageRecord(LIVE_ENTRY)
  assert.equal(record.at, '2026-11-17T11:31:16.789Z')
  assert.equal(record.model, 'deepseek-v4.1-flash')
  // amountUsd is "-0.0000": a plan-covered request costs the wallet nothing.
  assert.equal(record.wallet, 0)
  assert.equal(record.list, 0.0039)
  assert.equal(record.plan, 0.002)
  assert.equal(record.input, 557694)
  assert.equal(record.output, 163)
  assert.equal(record.cacheRead, 556672)
})

test('a record without a timestamp is dropped rather than dated now', () => {
  assert.equal(parseUsageRecord({ model: 'x' }), null)
  assert.equal(parseUsageRecord(null), null)
})

test('a record without a model still appears under a placeholder', () => {
  const record = parseUsageRecord({ createdAt: '2026-11-17T00:00:00Z', listChargedUsd: '1' })
  assert.equal(record.model, '未知模型')
  assert.equal(record.list, 1)
})

test('summarizing folds totals and sorts models by list cost', () => {
  const records = [
    parseUsageRecord({ ...LIVE_ENTRY }),
    parseUsageRecord({
      ...LIVE_ENTRY,
      model: 'deepseek-v4.1-flash-eco',
      listChargedUsd: '0.0100',
      designPlanContribution: { amountUsd: '0.0050' },
      createdAt: '2026-11-17T10:00:00.000Z',
    }),
  ]
  const summary = summarizeUsage(records)
  assert.equal(summary.today.requests, 2)
  assert.equal(summary.today.list, 0.0139)
  assert.equal(summary.today.wallet, 0)
  assert.equal(summary.today.plan, 0.007)
  assert.equal(summary.byModel[0].model, 'deepseek-v4.1-flash-eco')
  assert.equal(summary.byModel[0].requests, 1)
  // Newest first is the endpoint's order, so the head is the latest moment.
  assert.equal(summary.first, '2026-11-17T11:31:16.789Z')
  assert.equal(summary.last, '2026-11-17T10:00:00.000Z')
})

test('an empty day summarizes to null instead of zeros', () => {
  assert.equal(summarizeUsage([]), null)
  assert.equal(summarizeUsage(null), null)
})

test('per-request list cost is derived only when requests exist', () => {
  const summary = summarizeUsage([parseUsageRecord(LIVE_ENTRY)])
  assert.equal(summary.byModel[0].listPerRequest, 0.0039)
})

test('a trail entry carries a timestamp the browser can format', () => {
  const at = Date.UTC(2026, 10, 17, 11, 31, 16)
  const entry = trailEntry({ channel: 'cookie', url: 'https://x/y', result: { status: 200, ms: 120, kind: 'ok' }, at })
  assert.equal(entry.at, at)
  assert.equal(entry.httpStatus, 200)
  assert.equal(entry.result, 'ok')
})
