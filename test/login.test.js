import assert from 'node:assert/strict'
import test from 'node:test'

import { cookieHeaderFrom, findBrowser, isRemoteAuthority, loginAvailability, CDP_CONNECT_TIMEOUT_MS } from '../login/session-harvest.js'

test('cookie harvest keeps only the console domains', () => {
  const header = cookieHeaderFrom([
    { domain: '.open-design.ai', name: 'od_session', value: 'aaa' },
    { domain: 'open-design.ai', name: 'od_attr', value: 'bbb' },
    { domain: '.example.com', name: 'unrelated', value: 'ccc' },
    { domain: '.open-design.ai', name: '', value: 'd' },
  ])
  assert.equal(header, 'od_session=aaa; od_attr=bbb')
  assert.equal(header.includes('unrelated'), false)
})

test('cookie harvest returns nothing when no console cookie exists', () => {
  assert.equal(cookieHeaderFrom([{ domain: '.example.com', name: 'x', value: 'y' }]), '')
  assert.equal(cookieHeaderFrom(null), '')
})

test('login is unavailable when the window cannot be seen', () => {
  assert.equal(loginAvailability({ remote: true }).available, false)
  assert.equal(loginAvailability({ lanBind: true }).available, false)
  assert.equal(loginAvailability({}).available, true)
})

test('isRemoteAuthority treats loopback as local', () => {
  const makeRequest = (host) => ({ headers: { get: () => host }, url: 'http://127.0.0.1:1/' })
  assert.equal(isRemoteAuthority(makeRequest('127.0.0.1:50187')), false)
  assert.equal(isRemoteAuthority(makeRequest('localhost')), false)
  assert.equal(isRemoteAuthority(makeRequest('192.168.1.20:50187')), true)
})

test('a missing browser is reported rather than assumed', () => {
  assert.equal(findBrowser(() => false), null)
  assert.match(String(findBrowser((path) => path.includes('chrome.exe') && path.includes('Program Files'))), /chrome\.exe/)
})

test('the CDP deadline is long enough for a cold browser start', () => {
  assert.ok(CDP_CONNECT_TIMEOUT_MS >= 30_000)
})
