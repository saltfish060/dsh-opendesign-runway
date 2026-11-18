/**
 * dsh-opendesign-runway — host half.
 *
 * One provider, one reading contract. What it deliberately does not do: write the
 * vendor's config file, drive a password login (the console requires Turnstile),
 * or touch a browser profile the user actually browses in.
 */

import { read as readOpenDesign, sourceLine as openDesignSource } from './adapters/opendesign.js'
import {
  KEYS,
  controlKeyFromDisk,
  maskCookie,
  openDesignCookie,
  writeRecord,
  clearRecord,
} from './lib/credentials.js'
import { createStore } from './lib/store.js'
import { describeError, echo } from './lib/http.js'
import { createLoginFlow, defaultVerifier, isRemoteAuthority, loginAvailability } from './login/session-harvest.js'

export const name = 'opendesign-runway'
export const inject = ['tools']

/**
 * The single provider this plugin answers.
 *
 * The DSH route is configured as `opendesign`, but the console and older plugins
 * have also spelled it `open-design` / `open_design`; all three are accepted so a
 * rename on either side does not make the pill silently disappear.
 */
export const PROVIDER = 'opendesign'
export const PROVIDER_ALIASES = Object.freeze(['opendesign', 'open-design', 'open_design'])

/** Browser-half routes. */
export const PATHS = Object.freeze({
  snapshot: '/api/opendesign-runway/snapshot',
  login: '/api/opendesign-runway/login',
  credential: '/api/opendesign-runway/credential',
  logout: '/api/opendesign-runway/logout',
})

/** Default refresh floor, in seconds. */
const DEFAULT_MIN_INTERVAL_SEC = 60
/** Default failure cooldown, in seconds. */
const DEFAULT_COOLDOWN_SEC = 300

/** A trimmed non-empty string, else null. */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** JSON response helper. */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const tools = ctx.tools
  if (tools === undefined) return

  let credentials
  ctx.inject(['credentials'], (cctx) => { credentials = cctx.credentials })

  const store = createStore({
    minIntervalMs: DEFAULT_MIN_INTERVAL_SEC * 1000,
    cooldownMs: DEFAULT_COOLDOWN_SEC * 1000,
  })

  /** Resolve the reading, bypassing the cache policy. */
  const readProvider = async () => {
    const cookie = await openDesignCookie(credentials)
    const disk = controlKeyFromDisk()
    return readOpenDesign({
      source: 'auto',
      cookie,
      controlKey: disk.ok ? disk.controlKey : null,
    })
  }

  /**
   * Refresh, subject to the store's policy.
   * @param {{ force?: boolean }} [options]
   */
  const refresh = async (options = {}) => {
    if (options.force === true) store.clearCooldown(PROVIDER)
    if (options.force !== true && !store.mayAutoRefresh(PROVIDER)) return store.get(PROVIDER)
    return store.coalesce(PROVIDER, async () => {
      let reading
      try {
        reading = await readProvider()
      } catch (error) {
        reading = {
          provider: PROVIDER,
          status: 'network-error',
          identity: null,
          money: null,
          windows: [],
          usage: null,
          trail: [],
          message: `读取失败：${describeError(error)}`,
          queriedAt: Date.now(),
        }
      }
      if (reading.status === 'ok') store.recordSuccess(PROVIDER, reading)
      else store.recordFailure(PROVIDER, reading)
      return store.get(PROVIDER)
    })
  }

  /** A snapshot payload for the panel. */
  const snapshotOf = async (options = {}) => {
    const reading = await refresh(options)
    return {
      provider: PROVIDER,
      reading,
      burnRate: store.burnRate(PROVIDER),
      session: maskCookie(await openDesignCookie(credentials)),
      controlKey: (() => {
        const disk = controlKeyFromDisk()
        return { set: disk.ok, tail: disk.ok ? disk.controlKey.slice(-4) : '', path: disk.path, reason: disk.reason }
      })(),
      login: loginFlow.loginStatus(),
      sourceLine: openDesignSource(reading),
      minIntervalSec: DEFAULT_MIN_INTERVAL_SEC,
      asOf: Date.now(),
    }
  }

  // ── the agent tool ───────────────────────────────────────────────────────
  const quotaTool = {
    name: 'quota_lens',
    description:
      'Read the OpenDesign (AMR) balance and Design Plan quota for this machine. '
      + 'Returns a structured reading: identity of the credential used, wallet amount, plan '
      + 'windows with remaining percentage, exact credits (used / limit / remaining), reset time, '
      + 'and a `trail` of every HTTP step with its status. '
      + 'An empty `windows` array means the account has no Design Plan window — that is not an '
      + 'error, and the wallet figure is still valid. When `status` is not "ok", report its '
      + '`message` verbatim and do NOT estimate a number. '
      + 'To answer "will the quota run out before it resets", compute the rate from each window\'s '
      + 'credits.used divided by the elapsed time since its `windowStart`; the reading does not '
      + 'carry a precomputed rate because it depends on when the question is asked.',
    parameters: {
      type: 'object',
      properties: {
        refresh: {
          type: 'boolean',
          description: 'Force a fresh request, bypassing the refresh floor and failure cooldown.',
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const reading = await refresh({ force: args?.refresh === true })
      return JSON.stringify(reading, null, 2)
    },
  }
  ctx.effect(() => tools.register(quotaTool), 'opendesign-runway: quota_lens')

  // ── interactive sign-in ──────────────────────────────────────────────────
  const loginFlow = createLoginFlow({
    deployment: () => ({ lanBind: false }),
    verify: defaultVerifier(),
    onSuccess: async ({ cookie }) => {
      await writeRecord(credentials, KEYS['opendesign-session'], { cookie, savedAt: Date.now() })
      store.clearCooldown(PROVIDER)
    },
  })
  ctx.effect(() => () => { void loginFlow.dispose() }, 'opendesign-runway: sign-in teardown')

  // ── routes for the browser half ──────────────────────────────────────────
  ctx.inject(['connection'], (cctx) => {
    const conn = cctx.connection
    if (conn === undefined || conn === null || typeof conn.fetch?.register !== 'function') return

    const mount = (path, methods, handler, label) => {
      try {
        cctx.effect(() => conn.fetch.register({ path, methods, requestBody: 'buffered', fetch: handler }), `opendesign-runway: ${label}`)
      } catch (error) {
        console.error('[opendesign-runway]', `${label} registration skipped: ${describeError(error)}`)
      }
    }

    mount(PATHS.snapshot, ['GET'], async (request) => {
      const url = new URL(request.url)
      const force = url.searchParams.get('refresh') === '1'
      return json({ ...(await snapshotOf({ force })), availability: loginAvailability({ remote: isRemoteAuthority(request) }) })
    }, 'snapshot route')

    mount(PATHS.login, ['POST'], async (request) => {
      const availability = loginAvailability({ remote: isRemoteAuthority(request) })
      if (!availability.available) return json({ status: { state: 'failed', message: availability.reason }, availability })
      let body = {}
      try { body = await request.json() } catch {}
      if (body !== null && typeof body === 'object' && body.cancel === true) {
        return json({ status: await loginFlow.cancelLogin(), cancelled: true, availability })
      }
      return json({ status: await loginFlow.startLogin(), availability })
    }, 'login route')

    mount(PATHS.credential, ['POST'], async (request) => {
      let body
      try { body = await request.json() } catch { return json({ ok: false, message: '请求体不是合法 JSON。' }, 400) }
      const cookie = text(body?.cookie)
      if (cookie === undefined || cookie === null || cookie === '') return json({ ok: false, message: 'Cookie 是空的。' }, 400)
      // Prove the cookie before storing it; a refused one must not replace a working session.
      const probe = await readOpenDesign({ source: 'cookie', cookie, controlKey: null })
      if (probe.status !== 'ok') return json({ ok: false, message: probe.message ?? 'Cookie 未被接受。' }, 400)
      await writeRecord(credentials, KEYS['opendesign-session'], { cookie, savedAt: Date.now() })
      store.clearCooldown(PROVIDER)
      return json({ ok: true, windows: probe.windows.length, balance: probe.money?.amount ?? null })
    }, 'credential route')

    mount(PATHS.logout, ['POST'], async () => {
      await clearRecord(credentials, KEYS['opendesign-session'])
      store.clearCooldown(PROVIDER)
      return json({ ok: true })
    }, 'logout route')
  })
}

/** Exported for tests: the raw reading with no cache in the way. */
export { readOpenDesign, echo }
