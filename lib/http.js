/**
 * HTTP(S) transport for the account APIs.
 *
 * Why not plain `fetch`: on this machine `fetch` to some of these hosts fails TLS
 * with `CERT_HAS_EXPIRED` while an HTTP/1.1 request to the same origin answers
 * normally — `fetch` negotiates HTTP/2, and that path is fronted by an
 * interceptor here. `node:https` offers HTTP/1.1 only and reaches the real host.
 *
 * Every failure is classified rather than thrown: a caller decides what a 401
 * means, and a network failure must never look like a refused credential.
 */

import { request as httpsRequest } from 'node:https'

/** How much of an unparseable body is echoed back for diagnosis. */
const ECHO_LIMIT = 400

/** A short, safe description of an error. Never contains a header value. */
export function describeError(error) {
  if (error !== null && typeof error === 'object') {
    const code = typeof error.code === 'string' ? error.code : null
    const message = typeof error.message === 'string' ? error.message : String(error)
    const first = message.split('\n')[0].slice(0, 200)
    return code !== null ? `${code}: ${first}` : first
  }
  return String(error).split('\n')[0].slice(0, 200)
}

/** Truncate a body for an error message. */
export function echo(raw) {
  const value = String(raw ?? '')
  return value.length <= ECHO_LIMIT ? value : `${value.slice(0, ECHO_LIMIT)}…`
}

/** One GET/POST over HTTP/1.1, collecting the whole response. */
function once(url, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    if (target.protocol !== 'https:') {
      reject(new Error(`只支持 https：${url}`))
      return
    }
    const body = options.body
    const headers = { ...options.headers }
    if (body !== undefined && body !== null) headers['content-length'] = Buffer.byteLength(body)

    const req = httpsRequest({
      hostname: target.hostname,
      port: Number(target.port) || 443,
      path: `${target.pathname}${target.search}`,
      method: options.method ?? 'GET',
      headers,
      agent: false,
      servername: target.hostname,
    }, (response) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { raw += chunk })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? null, headers: response.headers, raw })
      })
      response.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
    if (body !== undefined && body !== null) req.write(body)
    req.end()
  })
}

/**
 * One request, classified.
 *
 * @param {object} input
 * @param {string} input.url
 * @param {'GET'|'POST'} [input.method]
 * @param {Record<string, string>} [input.headers]
 * @param {unknown} [input.json] JSON body
 * @param {number} [input.timeoutMs]
 * @returns {Promise<{
 *   ok: boolean,
 *   status: number | null,
 *   body: unknown,
 *   raw: string,
 *   ms: number,
 *   kind: 'ok' | 'unauthorized' | 'rate-limited' | 'http-error' | 'network-error' | 'parse-failed',
 *   error: unknown,
 * }>}
 */
export async function call(input) {
  const startedAt = Date.now()
  const headers = { accept: 'application/json', ...input.headers }
  let body
  if (input.json !== undefined) {
    body = JSON.stringify(input.json)
    headers['content-type'] = 'application/json'
  }
  let response
  try {
    response = await once(input.url, { method: input.method ?? 'GET', headers, body }, input.timeoutMs ?? 12000)
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      raw: '',
      ms: Date.now() - startedAt,
      kind: 'network-error',
      error,
    }
  }
  const ms = Date.now() - startedAt
  if (response.status === 401 || response.status === 403) {
    return { ok: false, status: response.status, body: null, raw: response.raw, ms, kind: 'unauthorized', error: null }
  }
  // 429 is not a credential verdict and not a generic HTTP error: the account is
  // fine and asking again later is the only correct response, so it gets its own
  // kind and the caller can surface "slow down" instead of "re-login".
  if (response.status === 429) {
    return { ok: false, status: 429, body: null, raw: response.raw, ms, kind: 'rate-limited', error: null }
  }
  if (response.status === null || response.status < 200 || response.status >= 300) {
    return { ok: false, status: response.status, body: null, raw: response.raw, ms, kind: 'http-error', error: null }
  }
  try {
    return { ok: true, status: response.status, body: JSON.parse(response.raw), raw: response.raw, ms, kind: 'ok', error: null }
  } catch (error) {
    return { ok: false, status: response.status, body: null, raw: response.raw, ms, kind: 'parse-failed', error }
  }
}

/**
 * A trail entry: one request, in the shape the panel renders.
 *
 * `at` is carried as an epoch millisecond stamp rather than a formatted string:
 * the browser half formats it with the reader's locale, which the host process
 * cannot know.
 * @param {object} input
 * @param {string} input.channel
 * @param {string} input.url
 * @param {{ status: number | null, ms: number, kind: string, error?: unknown }} input.result
 * @param {string} [input.note]
 * @param {number} [input.at]
 */
export function trailEntry(input) {
  return {
    channel: input.channel,
    url: input.url,
    at: Number.isFinite(input.at) ? input.at : Date.now(),
    httpStatus: input.result.status,
    ms: input.result.ms,
    result: input.note ?? input.result.kind,
  }
}
