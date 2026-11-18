import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeUsage, parseUsageRecord } from '../adapters/opendesign.js'

/**
 * The panel's usage block shows two things only: today's token burn and the two
 * most recent calls (model + time). These tests pin exactly that data, so a
 * change in aggregation cannot silently blank or bloat the panel.
 */

const ENTRY = {
  createdAt: '2026-11-17T11:31:16.789Z',
  model: 'deepseek-v4.1-flash',
  listChargedUsd: '0.0039',
  amountUsd: '0',
  designPlanContribution: { amountUsd: '0.0020' },
  inputTokens: 557694,
  outputTokens: 163,
  cacheReadTokens: 556672,
}

test('今日 token is input plus output, excluding cache reads', () => {
  const summary = summarizeUsage([parseUsageRecord(ENTRY)])
  assert.equal(summary.today.input + summary.today.output, 557694 + 163)
  // Cache reads are a separate figure; counting them would double the number.
  assert.equal(summary.today.cacheRead, 556672)
})

test('the two most recent calls carry model and time, newest first', () => {
  const records = [
    parseUsageRecord({ ...ENTRY, model: 'model-newest', createdAt: '2026-11-17T12:00:00.000Z' }),
    parseUsageRecord({ ...ENTRY, model: 'model-second', createdAt: '2026-11-17T11:00:00.000Z' }),
    parseUsageRecord({ ...ENTRY, model: 'model-third', createdAt: '2026-11-17T10:00:00.000Z' }),
  ]
  const summary = summarizeUsage(records)
  assert.equal(summary.recent.length, 2)
  assert.deepEqual(summary.recent[0], { model: 'model-newest', at: '2026-11-17T12:00:00.000Z' })
  assert.deepEqual(summary.recent[1], { model: 'model-second', at: '2026-11-17T11:00:00.000Z' })
})

test('a single record yields one recent call, not a padded pair', () => {
  const summary = summarizeUsage([parseUsageRecord(ENTRY)])
  assert.equal(summary.recent.length, 1)
  assert.equal(summary.recent[0].model, 'deepseek-v4.1-flash')
})

test('a record with no model still appears, under the placeholder', () => {
  const record = parseUsageRecord({ createdAt: '2026-11-17T00:00:00Z', inputTokens: 10, outputTokens: 5 })
  const summary = summarizeUsage([record])
  assert.equal(summary.recent[0].model, '未知模型')
  assert.equal(summary.today.input + summary.today.output, 15)
})

test('an account with no records reports null, so no usage block renders', () => {
  assert.equal(summarizeUsage([]), null)
  assert.equal(summarizeUsage(null), null)
})
