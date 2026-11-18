import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Display preferences shared between the pill and the settings page.
 *
 * The module below mirrors the store implemented in `client.js` (which runs in the
 * browser bundle and cannot be imported here). Keeping the contract under test
 * pins the two behaviours the UI depends on: a change reaches every subscriber at
 * once, and a storage that throws never breaks the store.
 */

const PILL_MODES = Object.freeze(['worst', 'both', 'short', 'long', 'none'])
const INDICATOR_MODES = Object.freeze(['ring', 'dot', 'none'])

function createPrefs(store) {
  const read = (key, allowed, fallback) => {
    try {
      const value = store.getItem(key)
      return allowed.includes(value) ? value : fallback
    } catch {
      return fallback
    }
  }
  const write = (key, value) => {
    try {
      store.setItem(key, value)
    } catch {}
  }
  let state = {
    mode: read('mode', PILL_MODES, 'worst'),
    indicator: read('indicator', INDICATOR_MODES, 'ring'),
  }
  const listeners = new Set()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get: () => state,
    set(patch) {
      state = { ...state, ...patch }
      if (Object.hasOwn(patch, 'mode')) write('mode', state.mode)
      if (Object.hasOwn(patch, 'indicator')) write('indicator', state.indicator)
      for (const listener of listeners) listener()
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

test('defaults are the tightest window and the ring', () => {
  const prefs = createPrefs(memoryStore())
  assert.deepEqual(prefs.get(), { mode: 'worst', indicator: 'ring' })
})

test('an unknown stored value falls back instead of rendering nothing', () => {
  const prefs = createPrefs(memoryStore({ mode: 'nonsense', indicator: 'nope' }))
  assert.deepEqual(prefs.get(), { mode: 'worst', indicator: 'ring' })
})

test('a stored value is honoured on load', () => {
  const prefs = createPrefs(memoryStore({ mode: 'both', indicator: 'dot' }))
  assert.deepEqual(prefs.get(), { mode: 'both', indicator: 'dot' })
})

test('setting a mode notifies every subscriber exactly once', () => {
  const prefs = createPrefs(memoryStore())
  let first = 0
  let second = 0
  prefs.subscribe(() => { first += 1 })
  prefs.subscribe(() => { second += 1 })
  prefs.set({ mode: 'short' })
  assert.equal(first, 1)
  assert.equal(second, 1)
  assert.equal(prefs.get().mode, 'short')
})

test('a mode change leaves the indicator untouched', () => {
  const prefs = createPrefs(memoryStore({ indicator: 'none' }))
  prefs.set({ mode: 'long' })
  assert.deepEqual(prefs.get(), { mode: 'long', indicator: 'none' })
})

test('changes are persisted so the next session keeps them', () => {
  const store = memoryStore()
  const prefs = createPrefs(store)
  prefs.set({ mode: 'both', indicator: 'dot' })
  assert.equal(store.map.get('mode'), 'both')
  assert.equal(store.map.get('indicator'), 'dot')
})

test('a storage that throws on read still yields defaults', () => {
  const store = { getItem: () => { throw new Error('denied') }, setItem: () => {} }
  const prefs = createPrefs(store)
  assert.deepEqual(prefs.get(), { mode: 'worst', indicator: 'ring' })
})

test('a storage that throws on write still updates the live state', () => {
  const store = { getItem: () => null, setItem: () => { throw new Error('denied') } }
  const prefs = createPrefs(store)
  prefs.set({ indicator: 'none' })
  assert.equal(prefs.get().indicator, 'none')
})

test('an unsubscribed listener stops hearing updates', () => {
  const prefs = createPrefs(memoryStore())
  let calls = 0
  const off = prefs.subscribe(() => { calls += 1 })
  prefs.set({ mode: 'both' })
  off()
  prefs.set({ mode: 'short' })
  assert.equal(calls, 1)
})
