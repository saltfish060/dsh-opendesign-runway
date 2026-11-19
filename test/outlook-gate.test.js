import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const CLIENT = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const NOW = Date.parse('2026-11-18T03:00:00Z')
const iso = (value) => new Date(value).toISOString()

function renderForecast({ durationSeconds = 18_000, elapsedMinutes, used, remaining }) {
  const elapsed = elapsedMinutes * 60_000
  const entry = {
    key: 'quota', label: '测试窗口', durationSeconds, remainingPct: 50,
    windowStart: iso(NOW - elapsed), resetAt: iso(NOW - elapsed + durationSeconds * 1000),
    credits: { used, remaining, limit: 50000 },
  }
  const snapshot = { reading: { status: 'ok', queriedAt: NOW, windows: [entry] } }
  const React = {
    createElement: (type, props, children) => ({ type, props, children }),
    useState: (value) => [value === null ? snapshot : value, () => {}],
    useId: () => 'test-id',
    useRef: (current) => ({ current }),
    useCallback: (fn) => fn,
    // The settings section reads the last-good snapshot out of localStorage on
    // its first render; in this harness it starts from the fixture instead.
    useMemo: (factory) => factory(),
    useEffect() {},
    useSyncExternalStore: (_subscribe, read) => read(),
  }
  let settings
  class FixedDate extends Date { static now() { return NOW } }
  runInNewContext(CLIENT, {
    Date: FixedDate,
    window: { __ModuleLoader__: { load({ factory }) {
      factory(() => React).apply({
        effect(callback, description) { if (description.endsWith(': settings section')) callback() },
        inject() {},
        slots: {
          inject(_name, callback) { callback() },
          register(_slot, component) { settings = component },
        },
      })
    } } },
  })
  const overview = settings().children[0]
  const windows = overview.children.flat().find((child) => child?.props?.className === 'ql-settings-windows')
  const row = windows.children[0]
  const outlook = row.type(row.props).children.find((child) => child?.props?.className?.startsWith('ql-outlook'))
  return outlook?.children ?? null
}

test('short quota forecasts use minutes when the pool is burning quickly', () => {
  assert.equal(renderForecast({ elapsedMinutes: 60, used: 40000, remaining: 10000 }), '照此速度，约 15 分钟后耗尽')
})

test('the first five minutes of a short quota window suppress extrapolation', () => {
  assert.equal(renderForecast({ elapsedMinutes: 3, used: 40000, remaining: 10000 }), '窗口刚开始，积累几分钟后再估算')
  assert.match(renderForecast({ elapsedMinutes: 5, used: 40000, remaining: 10000 }), /后耗尽/)
})

test('the long quota window still forecasts survival', () => {
  assert.equal(renderForecast({ durationSeconds: 604_800, elapsedMinutes: 2000, used: 100, remaining: 49900 }), '照此速度能撑到重置')
})

test('missing counts are ignored and an empty quota is reported immediately', () => {
  assert.equal(renderForecast({ elapsedMinutes: 1, used: null, remaining: 30000 }), null)
  assert.equal(renderForecast({ elapsedMinutes: 1, used: 50000, remaining: 0 }), '当前额度已耗尽')
})
