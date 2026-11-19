import assert from 'node:assert/strict'
import test from 'node:test'

import { readFileSync } from 'node:fs'

/**
 * The settings page opens with the last good reading, not an empty page.
 *
 * A settings page whose numbers arrive a second after it opens reads as broken,
 * and the values it is about to show are the ones the pill already fetched. Both
 * pages therefore seed from the same cached snapshot.
 *
 * The cache helpers live in the browser bundle, so this reads the source and
 * checks the three properties the behaviour depends on: the settings section
 * seeds from the cache, only a healthy reading is cached, and a cache failure
 * degrades to no cache instead of throwing.
 */

const CLIENT = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('the settings section seeds its first render from the cached snapshot', () => {
  const section = CLIENT.slice(CLIENT.indexOf('function SettingsSection'), CLIENT.indexOf('function SettingsSection') + 1200)
  assert.match(section, /React\.useMemo\(readCachedSnapshot/)
  assert.match(section, /useState\(cached === null \? null : cached\.body\)/)
})

test('a reading is cached only when it succeeded', () => {
  const section = CLIENT.slice(CLIENT.indexOf('function SettingsSection'), CLIENT.indexOf('function SettingsSection') + 3000)
  assert.match(section, /if \(result\.body\.reading\.status === 'ok'\) writeCachedSnapshot\(result\.body\)/)
})

test('reading the cache never throws, whatever the storage does', () => {
  const read = CLIENT.slice(CLIENT.indexOf('function readCachedSnapshot'), CLIENT.indexOf('function writeCachedSnapshot'))
  // The whole body is inside a try, and the catch returns null.
  assert.match(read, /try \{[\s\S]*catch \{[\s\S]*return null[\s\S]*\}/)
})

test('writing the cache swallows a storage refusal', () => {
  const write = CLIENT.slice(CLIENT.indexOf('function writeCachedSnapshot'), CLIENT.indexOf('function snapshotPath'))
  assert.match(write, /try \{[\s\S]*setItem[\s\S]*catch \{\}/)
})

test('an entry older than the ceiling is refused', () => {
  const read = CLIENT.slice(CLIENT.indexOf('function readCachedSnapshot'), CLIENT.indexOf('function writeCachedSnapshot'))
  assert.match(read, /Date\.now\(\) - parsed\.at > CACHE_MAX_AGE_MS/)
  assert.match(CLIENT, /const CACHE_MAX_AGE_MS = 30 \* 60 \* 1000/)
})

test('the settings page polls on its own and honours the chosen interval', () => {
  const section = CLIENT.slice(CLIENT.indexOf('function SettingsSection'), CLIENT.indexOf('function SettingsSection') + 6000)
  assert.match(section, /pollSnapshot\(refresh, running \? LOGIN_POLL_MS : Number\(refreshSeconds\) \* 1000\)/)
})

test('the manual refresh is forced and does not queue behind a poll', () => {
  const section = CLIENT.slice(CLIENT.indexOf('function SettingsSection'))
  assert.match(section, /if \(manualRefresh\.current\) return/)
  // The button passes force=true; the call it reaches builds the forced path.
  assert.match(section, /void refresh\(true\)/)
  assert.match(section, /if \(force\) \{[\s\S]*manualRefresh\.current = true/)
})
