import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Snapshot cache: a restart shows the previous numbers immediately, marked stale,
 * while a real read is on its way.
 *
 * The module mirrors the cache in `client.js` (browser bundle, not importable
 * here) so the three rules the UI depends on stay pinned: only an `ok` reading is
 * cached, an old entry is refused, and a storage failure degrades to "no cache".
 */

const KEY = 'lastSnapshot'
const MAX_AGE_MS = 30 * 60 * 1000

function createCache(store, now) {
  return {
    read() {
      try {
        const raw = store.getItem(KEY)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return null
        if (parsed.provider !== 'opendesign') return null
        if (typeof parsed.at !== 'number' || now() - parsed.at > MAX_AGE_MS) return null
        if (parsed.body === null || typeof parsed.body !== 'object') return null
        return parsed
      } catch {
        return null
      }
    },
    write(body) {
      try {
        store.setItem(KEY, JSON.stringify({ provider: 'opendesign', at: now(), body }))
      } catch {}
    },
  }
}

function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    map,
  }
}

test('an empty store has no cached reading', () => {
  const cache = createCache(memoryStore(), () => 1_000)
  assert.equal(cache.read(), null)
})

test('a fresh entry round-trips', () => {
  let clock = 1_000
  const cache = createCache(memoryStore(), () => clock)
  cache.write({ reading: { status: 'ok' } })
  clock = 2_000
  const cached = cache.read()
  assert.notEqual(cached, null)
  assert.equal(cached.body.reading.status, 'ok')
})

test('an entry older than the limit is refused', () => {
  let clock = 1_000
  const store = memoryStore()
  const cache = createCache(store, () => clock)
  cache.write({ reading: { status: 'ok' } })
  clock = 1_000 + MAX_AGE_MS + 1
  assert.equal(cache.read(), null)
})

test('a corrupt entry is refused rather than thrown', () => {
  const cache = createCache(memoryStore({ [KEY]: '{not json' }), () => 1_000)
  assert.equal(cache.read(), null)
})

test('an entry for another provider is refused', () => {
  const store = memoryStore({
    [KEY]: JSON.stringify({ provider: 'sui-xiang', at: Date.now(), body: {} }),
  })
  const cache = createCache(store, () => Date.now())
  assert.equal(cache.read(), null)
})

test('a storage that throws on read degrades to no cache', () => {
  const store = { getItem: () => { throw new Error('denied') }, setItem: () => {} }
  const cache = createCache(store, () => 1_000)
  assert.equal(cache.read(), null)
})

test('a storage that throws on write leaves the app running', () => {
  const store = { getItem: () => null, setItem: () => { throw new Error('denied') } }
  const cache = createCache(store, () => 1_000)
  assert.doesNotThrow(() => cache.write({ reading: { status: 'ok' } }))
})
