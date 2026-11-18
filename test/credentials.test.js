import assert from 'node:assert/strict'
import test from 'node:test'

import { KEYS, LEGACY_KEYS, readRecord, openDesignCookie, writeRecord, clearRecord } from '../lib/credentials.js'

/** A credential service double backed by a Map. */
function fakeCredentials(initial = {}) {
  const records = new Map(Object.entries(initial))
  return {
    records,
    async readRecord(key) {
      const payload = records.get(key)
      if (payload === undefined) throw new Error('not found')
      return { kind: 'grant', payload }
    },
    async modifyRecord(key, apply) {
      records.set(key, (await apply())?.payload ?? null)
    },
    async deleteRecord(key) {
      records.delete(key)
    },
  }
}

test('only OpenDesign keys are declared', () => {
  assert.deepEqual(Object.keys(KEYS), ['opendesign-session'])
  // Two earlier keys may already hold a valid cookie on this machine.
  assert.deepEqual(Object.keys(LEGACY_KEYS), ['opendesign-session', 'quota-lens-session'])
})

test('a cookie stored under this plugin key wins', async () => {
  const credentials = fakeCredentials({
    [KEYS['opendesign-session']]: { cookie: 'own=1' },
    [LEGACY_KEYS['opendesign-session']]: { cookie: 'legacy=2' },
  })
  assert.equal(await openDesignCookie(credentials), 'own=1')
})

test('a cookie under the previous plugin key is still usable', async () => {
  const credentials = fakeCredentials({ [LEGACY_KEYS['opendesign-session']]: { cookie: 'a=1; b=2' } })
  assert.equal(await openDesignCookie(credentials), 'a=1; b=2')
})

test('a cookie under an earlier name of this plugin is still usable', async () => {
  const credentials = fakeCredentials({ [LEGACY_KEYS['quota-lens-session']]: { cookie: 'c=3' } })
  assert.equal(await openDesignCookie(credentials), 'c=3')
})

test('this plugin key beats every earlier key', async () => {
  const credentials = fakeCredentials({
    [KEYS['opendesign-session']]: { cookie: 'own=1' },
    [LEGACY_KEYS['quota-lens-session']]: { cookie: 'c=3' },
    [LEGACY_KEYS['opendesign-session']]: { cookie: 'legacy=2' },
  })
  assert.equal(await openDesignCookie(credentials), 'own=1')
})

test('no stored cookie reads as null, not as an empty string', async () => {
  const credentials = fakeCredentials()
  assert.equal(await openDesignCookie(credentials), null)
})

test('a credential service that throws on read degrades to null', async () => {
  const credentials = { readRecord: async () => { throw new Error('boom') } }
  assert.equal(await readRecord(credentials, 'anything'), null)
  assert.equal(await openDesignCookie(credentials), null)
})

test('writing without a credential service is an error, not a silent success', async () => {
  await assert.rejects(() => writeRecord(undefined, 'k', { cookie: 'c' }), /凭据服务/)
})

test('write then read round-trips, and clear removes it', async () => {
  const credentials = fakeCredentials()
  await writeRecord(credentials, KEYS['opendesign-session'], { cookie: 'fresh=1' })
  assert.equal(await openDesignCookie(credentials), 'fresh=1')
  await clearRecord(credentials, KEYS['opendesign-session'])
  assert.equal(await openDesignCookie(credentials), null)
})

test('clearing a record that was never there is not an error', async () => {
  const credentials = fakeCredentials()
  await assert.doesNotReject(() => clearRecord(credentials, 'missing/key'))
})
