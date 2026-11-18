/**
 * Credential access for dsh-opendesign-quota.
 *
 * Two hard rules:
 *   - DSH's credential service is the only place this plugin writes a secret;
 *   - `~/.amr/config.json` is read-only here. The vendor's CLI owns that file, and
 *     writing it from a plugin would fight the next `vela login`.
 *
 * A refused credential is never persisted, and a missing credential is reported
 * as missing rather than as an empty reading.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Credential record keys this plugin owns. */
export const KEYS = Object.freeze({
  'opendesign-session': 'opendesign-quota/opendesign-session',
})

/**
 * Keys written by earlier builds and by the plugins this one replaces.
 *
 * A working OpenDesign session may already sit under one of these on this machine.
 * Reading them is a one-way fallback: it saves the user from pasting a cookie that
 * was already valid, and the next successful read migrates it to this plugin's own
 * key. They are never written.
 */
export const LEGACY_KEYS = Object.freeze({
  'opendesign-session': 'dsh-opendesign-limit/browser-session',
  'quota-lens-session': 'quota-lens/opendesign-session',
})

/** Where OpenDesign's own clients keep the controlKey. */
export const AMR_DIR = '.amr'
export const DEFAULT_AMR_API = 'https://amr-api.open-design.ai'

/** A trimmed non-empty string, else null. */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Read the payload of one credential record, or null. */
export async function readRecord(credentials, key) {
  if (credentials === undefined || credentials === null || typeof credentials.readRecord !== 'function') return null
  try {
    const record = await credentials.readRecord(key)
    const payload = record !== null && typeof record === 'object' ? record.payload : null
    return payload !== null && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}

/**
 * Write one record, replacing any previous value.
 * @throws when the store refuses the write, because a sign-in that did not
 *   persist must not look like success.
 */
export async function writeRecord(credentials, key, payload) {
  if (credentials === undefined || credentials === null || typeof credentials.modifyRecord !== 'function') {
    throw new Error('这个 DSH 没有提供凭据服务。')
  }
  await credentials.modifyRecord(key, async () => ({ kind: 'grant', payload }))
}

/** Remove one record; a missing record is already the desired state. */
export async function clearRecord(credentials, key) {
  if (credentials === undefined || credentials === null || typeof credentials.deleteRecord !== 'function') return
  try {
    await credentials.deleteRecord(key)
  } catch {}
}

/**
 * The stored OpenDesign browser session cookie, or null.
 *
 * Falls back to the keys of earlier builds and of the plugin this one replaces,
 * so an already-valid session does not have to be pasted again.
 */
export async function openDesignCookie(credentials) {
  const own = await readRecord(credentials, KEYS['opendesign-session'])
  const direct = text(own?.cookie)
  if (direct !== null) return direct
  for (const key of Object.values(LEGACY_KEYS)) {
    const legacy = await readRecord(credentials, key)
    const cookie = text(legacy?.cookie)
    if (cookie !== null) return cookie
  }
  return null
}

/** What the UI may know about a stored session: whether it exists and when. */
export function maskCookie(cookie) {
  const value = text(cookie)
  if (value === null) return { set: false, tail: '' }
  return { set: true, tail: value.slice(-4) }
}

/**
 * Resolve the AMR config path the vendor's own daemon uses:
 * `$AMR_HOME/config.json`, else `<home>/.amr/config.json`.
 */
export function amrConfigPath(env = process.env) {
  const raw = typeof env.AMR_HOME === 'string' ? env.AMR_HOME.trim() : ''
  if (raw === '') return join(homedir(), AMR_DIR, 'config.json')
  if (raw === '~') return join(homedir(), 'config.json')
  if (raw.startsWith('~/') || raw.startsWith('\\~\\')) return join(homedir(), raw.slice(2), 'config.json')
  return join(raw, 'config.json')
}

/**
 * Read the on-disk controlKey. Read-only by design; a failure is reported, not
 * repaired.
 * @returns {{ ok: boolean, controlKey: string | null, apiUrl: string, path: string, reason: string | null }}
 */
export function controlKeyFromDisk(env = process.env, readFile = readFileSync) {
  const path = amrConfigPath(env)
  const base = { ok: false, controlKey: null, apiUrl: DEFAULT_AMR_API, path, reason: null }
  let doc
  try {
    doc = JSON.parse(readFile(path, 'utf8'))
  } catch (error) {
    return { ...base, reason: error?.code === 'ENOENT' ? `没有 ${path}` : `读取失败：${String(error?.message ?? error)}` }
  }
  const profiles = doc !== null && typeof doc === 'object' ? doc.profiles : undefined
  if (profiles === null || typeof profiles !== 'object') return { ...base, reason: `${path} 里没有 profiles` }
  const names = Object.keys(profiles)
  if (names.length === 0) return { ...base, reason: `${path} 里没有登录档案` }
  const wanted = text(env.OPEN_DESIGN_AMR_PROFILE) ?? text(env.VELA_PROFILE) ?? 'prod'
  const name = names.includes(wanted) ? wanted : (names.length === 1 ? names[0] : null)
  if (name === null) return { ...base, reason: `没有「${wanted}」档案（现有：${names.join('、')}）` }
  const record = profiles[name] !== null && typeof profiles[name] === 'object' ? profiles[name] : {}
  const controlKey = text(record.controlKey)
  const apiUrl = text(record.apiUrl) ?? text(env.VELA_API_URL) ?? DEFAULT_AMR_API
  if (controlKey === null) return { ...base, apiUrl, reason: `档案「${name}」里没有 controlKey` }
  return { ok: true, controlKey, apiUrl, path, reason: null }
}
