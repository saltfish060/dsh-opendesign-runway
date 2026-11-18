import assert from 'node:assert/strict'
import test from 'node:test'

import { cacheSavedFor, parseUsageRecord, summarizeUsage } from '../adapters/opendesign.js'

/**
 * Cache savings, computed from the vendor's own per-record prices.
 *
 * Cached tokens bill at a small fraction of the input rate, so the saved amount
 * is a subtraction between two prices the record already carries — not an
 * estimate against an external price table.
 */

function record(overrides = {}) {
  return {
    createdAt: '2026-11-18T09:25:15.839Z',
    model: 'deepseek-v4.1-flash',
    inputTokens: 1_000_000,
    outputTokens: 1_000,
    cacheReadTokens: 900_000,
    listChargedUsd: '0.004',
    amountUsd: '-0.0000',
    designPlanContribution: { amountUsd: '0.002' },
    unitPrices: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0.3 },
    ...overrides,
  }
}

test('savings follow the price difference times the cached tokens', () => {
  // 900k tokens at (0.3 - 0.006) per million = 0.2646
  assert.equal(cacheSavedFor(record(), 900_000).toFixed(4), '0.2646')
})

test('a record with no cached tokens saves nothing, which is a real answer', () => {
  assert.equal(cacheSavedFor(record({ cacheReadTokens: 0 }), 0), 0)
})

test('a record without prices yields null rather than zero', () => {
  // Zero would claim "cache saved you nothing"; null says "cannot tell".
  assert.equal(cacheSavedFor(record({ unitPrices: null }), 900_000), null)
  assert.equal(cacheSavedFor(record({ unitPrices: {} }), 900_000), null)
  assert.equal(cacheSavedFor(record({ unitPrices: { input: 0.3 } }), 900_000), null)
})

test('a cache price above the input price is refused, not turned negative', () => {
  const odd = record({ unitPrices: { input: 0.006, cacheRead: 0.3 } })
  assert.equal(cacheSavedFor(odd, 900_000), null)
})

test('a parsed record carries its own saving', () => {
  const parsed = parseUsageRecord(record())
  assert.equal(parsed.cacheSaved.toFixed(4), '0.2646')
  assert.equal(parsed.cacheRead, 900_000)
})

test('a parsed record without prices has a null saving', () => {
  assert.equal(parseUsageRecord(record({ unitPrices: null })).cacheSaved, null)
})

test('the day total adds up and marks itself complete', () => {
  const summary = summarizeUsage([parseUsageRecord(record()), parseUsageRecord(record())])
  assert.equal(summary.today.cacheSaved.toFixed(4), '0.5292')
  assert.equal(summary.today.cacheSavedComplete, true)
})

test('one unpriced record marks the total incomplete, and still counts it', () => {
  const summary = summarizeUsage([
    parseUsageRecord(record()),
    parseUsageRecord(record({ unitPrices: null })),
  ])
  // The priced record still contributes; the flag says the total is a floor.
  assert.equal(summary.today.cacheSaved.toFixed(4), '0.2646')
  assert.equal(summary.today.cacheSavedComplete, false)
  assert.equal(summary.today.requests, 2)
})

test('an empty record list has no summary at all', () => {
  assert.equal(summarizeUsage([]), null)
})
