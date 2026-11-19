/**
 * Adapter: OpenDesign (AMR).
 *
 * Two credential channels, admitted by different routes — measured live on this
 * machine:
 *
 *   channel      credential        can read
 *   control      vela_ctrl_…       workspaces, billing/preflight, wallet/balance, billing/summary
 *   cookie       browser session   workspaces, billing/coding-plan-usage
 *
 * `auto` asks the cookie channel first on purpose: only a browser session can
 * report the plan windows, and a controlKey answering with an empty window list
 * looks exactly like "no quota left" — the mistake the previous plugin made.
 *
 * An empty window list is not a failure. It means the account has no active
 * Design Plan, and the reading degrades to the wallet balance.
 */

import { call, echo, trailEntry } from '../lib/http.js'

export const PROVIDER = 'opendesign'
export const LABEL = 'OpenDesign'

/** Control plane; the inference gateway is a different host and serves no billing routes. */
export const API = 'https://amr-api.open-design.ai'
/** Console origin a browser session cookie belongs to. */
export const CONSOLE = 'https://open-design.ai'

/** A number from a number or numeric string, else null. */
function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** A credit count; the vendor sends decimal strings that can exceed 2^53. */
function credit(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim())
  return null
}

/** A duration in seconds rendered the way the vendor's own panel does. */
export function windowLabel(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return '额度窗口'
  const day = 86_400
  const hour = 3_600
  if (value % day === 0) return `${value / day} 天`
  if (value % hour === 0) return `${value / hour} 小时`
  return `${Math.round(value / hour)} 小时`
}

/** Remaining share of one window, from the exact credit pair. */
export function remainingPercent(used, limit) {
  const usedCount = credit(used)
  const limitCount = credit(limit)
  if (usedCount === null || limitCount === null || limitCount <= 0n) return null
  const basisPoints = Number((usedCount * 10_000n) / limitCount)
  return Math.max(0, Math.min(100, 100 - Math.round(basisPoints / 100)))
}

/**
 * Parse one `codingPlan` block into panel windows.
 *
 * An empty list is a real answer, so this returns [] rather than throwing.
 *
 * The credit counts and `windowStart` are carried through, not just the
 * percentage: they are what makes "will this run out before it resets" a
 * computable question. `credits` holds exact BigInt values as decimal strings so
 * a pool past 2^53 is never rounded on the way to the UI.
 * @param {unknown} block
 * @returns {{ tier: string | null, windows: object[] }}
 */
export function parseCodingPlan(block) {
  const root = block !== null && typeof block === 'object' ? block : {}
  const tier = typeof root.tier === 'string' && root.tier.trim() !== '' ? root.tier.trim() : null
  const list = Array.isArray(root.windows) ? root.windows : []
  const windows = []
  for (const [index, entry] of list.entries()) {
    if (entry === null || typeof entry !== 'object') continue
    const limit = credit(entry.limitCredits)
    const used = credit(entry.usedCredits)
    const remaining = credit(entry.remainingCredits)
    const usedCount = used ?? (limit !== null && remaining !== null ? limit - remaining : null)
    const remainingCount = remaining ?? (limit !== null && usedCount !== null ? limit - usedCount : null)
    const pct = remainingPercent(usedCount, limit)
    const seconds = num(entry.durationSeconds)
    const resetAt = typeof entry.resetsAt === 'string' && entry.resetsAt !== '' ? entry.resetsAt : null
    const windowStart = typeof entry.windowStart === 'string' && entry.windowStart !== ''
      ? entry.windowStart
      : null
    windows.push({
      key: typeof entry.policyId === 'string' && entry.policyId !== '' ? entry.policyId : `w${index}`,
      label: `Design Plan · ${windowLabel(seconds)}`,
      remainingPct: pct,
      resetAt,
      durationSeconds: seconds,
      windowStart,
      credits: {
        used: usedCount === null ? null : usedCount.toString(),
        limit: limit === null ? null : limit.toString(),
        remaining: remainingCount === null ? null : remainingCount.toString(),
      },
    })
  }
  windows.sort((left, right) => (left.durationSeconds ?? 0) - (right.durationSeconds ?? 0))
  return { tier, windows }
}

/**
 * What the current burn rate implies for one window.
 *
 * Answers the only actionable question a plan user has: will this pool run out
 * before it resets? The rate is measured from the window's own anchor
 * (`windowStart`), so it does not depend on how long this process has been
 * running — a restart or a second machine sees the same answer.
 *
 * Returns null rather than guessing when the inputs cannot support a rate: a
 * percentage without credits, a missing anchor that cannot be derived, or a
 * window that has not started yet.
 * @param {object} window a parsed window from {@link parseCodingPlan}
 * @param {{ now?: number }} [options]
 * @returns {{ perHour: number, hoursToExhaust: number | null, hoursToReset: number,
 *   verdict: 'exhausts' | 'survives' | 'idle', anchor: 'windowStart' | 'derived' } | null}
 */
export function windowOutlook(window, options = {}) {
  if (window === null || typeof window !== 'object') return null
  const now = Number.isFinite(options.now) ? options.now : Date.now()

  const resetAt = typeof window.resetAt === 'string' ? Date.parse(window.resetAt) : NaN
  if (!Number.isFinite(resetAt)) return null
  const hoursToReset = (resetAt - now) / 3_600_000
  if (!Number.isFinite(hoursToReset) || hoursToReset <= 0) return null

  // The anchor: the window's own start, or the same instant derived from its
  // reset time and duration. Anything else is a guess and is refused.
  let anchorAt = typeof window.windowStart === 'string' ? Date.parse(window.windowStart) : NaN
  let anchor = 'windowStart'
  if (!Number.isFinite(anchorAt)) {
    const seconds = Number(window.durationSeconds)
    if (!Number.isFinite(seconds) || seconds <= 0) return null
    anchorAt = resetAt - seconds * 1000
    anchor = 'derived'
  }
  const elapsedHours = (now - anchorAt) / 3_600_000
  if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) return null

  const credits = window.credits ?? {}
  const usedCount = credit(credits.used)
  const remainingCount = credit(credits.remaining)
  if (usedCount === null || remainingCount === null) return null

  // Nothing consumed yet: a rate of zero cannot be extrapolated into an answer,
  // and saying "never runs out" would be a claim about the future, not a reading.
  if (usedCount === 0n) {
    return { perHour: 0, hoursToExhaust: null, hoursToReset, verdict: 'idle', anchor }
  }

  const perHour = Number(usedCount) / elapsedHours
  if (!Number.isFinite(perHour) || perHour <= 0) return null
  const hoursToExhaust = Number(remainingCount) / perHour

  return {
    perHour,
    hoursToExhaust,
    hoursToReset,
    verdict: hoursToExhaust < hoursToReset ? 'exhausts' : 'survives',
    anchor,
  }
}

/** Pick the workspace a personal subscription bills against. */
export function pickWorkspace(body) {
  const list = Array.isArray(body) ? body
    : Array.isArray(body?.items) ? body.items
      : Array.isArray(body?.workspaces) ? body.workspaces
        : Array.isArray(body?.data) ? body.data
          : []
  const rows = list
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((entry) => ({
      id: typeof entry.workspaceId === 'string' ? entry.workspaceId : (typeof entry.id === 'string' ? entry.id : null),
      type: typeof entry.workspaceType === 'string' ? entry.workspaceType : (typeof entry.type === 'string' ? entry.type : null),
    }))
    .filter((entry) => entry.id !== null)
  if (rows.length === 0) return null
  return rows.find((entry) => entry.type === 'personal') ?? rows[0]
}

/** A masked identity for a controlKey: enough to tell two keys apart. */
export function keyIdentity(controlKey) {
  const value = typeof controlKey === 'string' ? controlKey.trim() : ''
  if (value === '') return null
  return { label: 'controlKey', tail: value.slice(-4), vipLevel: null }
}

/** Response headers a browser session needs to look like the console's own request. */
function consoleHeaders(cookie) {
  return {
    cookie,
    origin: CONSOLE,
    referer: `${CONSOLE}/`,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  }
}

/**
 * The consumption figures `billing/summary` carries.
 *
 * These are the only usage numbers the control plane exposes for this account:
 * there is no per-window or per-model breakdown on this route, and the console's
 * own dashboard reads the same two fields.
 * @param {unknown} body
 * @returns {{ today: number | null, total: number | null, recharged: number | null, usageCount: number | null } | null}
 */
export function parseSummaryUsage(body) {
  if (body === null || typeof body !== 'object') return null
  const today = num(body.todayConsumedUsd)
  const total = num(body.totalConsumedUsd)
  const recharged = num(body.totalRechargedUsd)
  const usageCount = num(body.usageCount)
  if (today === null && total === null && recharged === null) return null
  return { today, total, recharged, usageCount }
}

/**
 * The subscription fields worth showing next to the money.
 * @param {unknown} body
 * @returns {{ status: string | null, periodStart: string | null, periodEnd: string | null,
 *   cancelAtPeriodEnd: boolean, tier: string | null } | null}
 */
export function parseSummaryBilling(body) {
  if (body === null || typeof body !== 'object') return null
  const status = typeof body.subscriptionStatus === 'string' && body.subscriptionStatus !== ''
    ? body.subscriptionStatus
    : null
  const periodStart = typeof body.subscriptionCurrentPeriodStart === 'string' && body.subscriptionCurrentPeriodStart !== ''
    ? body.subscriptionCurrentPeriodStart
    : null
  const periodEnd = typeof body.subscriptionCurrentPeriodEnd === 'string' && body.subscriptionCurrentPeriodEnd !== ''
    ? body.subscriptionCurrentPeriodEnd
    : null
  const tier = typeof body.membershipTier === 'string' && body.membershipTier !== '' ? body.membershipTier : null
  if (status === null && periodEnd === null && tier === null) return null
  return { status, periodStart, periodEnd, cancelAtPeriodEnd: body.subscriptionCancelAtPeriodEnd === true, tier }
}

/**
 * Verify a browser session against the auth service.
 *
 * This is the same call the console makes, so "signed in" means what the console
 * means by it — not "a cookie with a familiar name exists".
 * @param {string} cookie
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, session: object | null, result: object }>}
 */
export async function verifySession(cookie, timeoutMs = 12000) {
  const url = `${API}/api/auth/get-session`
  const result = await call({ url, headers: consoleHeaders(cookie), timeoutMs })
  if (!result.ok) return { ok: false, session: null, result }
  const body = result.body
  const sessionId = body !== null && typeof body === 'object' && body.session !== null && typeof body.session === 'object'
    ? body.session.id
    : null
  return { ok: typeof sessionId === 'string' && sessionId !== '', session: body, result }
}

/** Read through the controlKey channel. */
async function readControl(controlKey, timeoutMs) {
  const trail = []
  const headers = { authorization: `Bearer ${controlKey}` }

  const list = await call({ url: `${API}/api/v1/workspaces`, headers, timeoutMs })
  trail.push(trailEntry({ channel: 'control', url: `${API}/api/v1/workspaces`, result: list }))
  if (!list.ok) return { trail, list, workspace: null }

  const workspace = pickWorkspace(list.body)
  if (workspace === null) return { trail, list, workspace: null }

  const preflight = await call({
    url: `${API}/api/v1/workspaces/${encodeURIComponent(workspace.id)}/billing/preflight`,
    headers,
    timeoutMs,
  })
  trail.push(trailEntry({ channel: 'control', url: `${API}/api/v1/workspaces/${workspace.id}/billing/preflight`, result: preflight }))
  if (!preflight.ok) return { trail, list, workspace, preflight }

  const summary = await call({ url: `${API}/api/v1/billing/summary`, headers, timeoutMs })
  trail.push(trailEntry({ channel: 'control', url: `${API}/api/v1/billing/summary`, result: summary }))

  const body = preflight.body !== null && typeof preflight.body === 'object' ? preflight.body : {}
  const plan = parseCodingPlan(body.codingPlan)
  const amount = num(body.balanceUsd)
  return {
    trail,
    list,
    workspace,
    reading: {
      amount,
      windows: plan.windows,
      tier: plan.tier ?? (summary.ok && summary.body?.membershipTier !== undefined ? String(summary.body.membershipTier ?? '') || null : null),
      creditsPerUsd: summary.ok ? num(summary.body?.creditsPerUsd) : null,
      periodEnd: summary.ok && typeof summary.body?.subscriptionCurrentPeriodEnd === 'string'
        ? summary.body.subscriptionCurrentPeriodEnd
        : null,
      usage: summary.ok ? parseSummaryUsage(summary.body) : null,
      billing: summary.ok ? parseSummaryBilling(summary.body) : null,
      endpoint: 'preflight',
    },
  }
}

/** Read through the browser-session channel. */
async function readCookie(cookie, timeoutMs, knownWorkspaceId = null) {
  const trail = []
  const headers = consoleHeaders(cookie)

  let workspaceId = knownWorkspaceId
  if (workspaceId === null) {
    const list = await call({ url: `${API}/api/v1/workspaces`, headers, timeoutMs })
    trail.push(trailEntry({ channel: 'cookie', url: `${API}/api/v1/workspaces`, result: list }))
    if (!list.ok) return { trail, list, reading: null }
    const workspace = pickWorkspace(list.body)
    if (workspace === null) return { trail, list, reading: null }
    workspaceId = workspace.id
  }

  const base = `${API}/api/v1/workspaces/${encodeURIComponent(workspaceId)}`
  const usage = await call({ url: `${base}/billing/coding-plan-usage`, headers, timeoutMs })
  trail.push(trailEntry({ channel: 'cookie', url: `${base}/billing/coding-plan-usage`, result: usage }))

  // The wallet is a separate read from the plan. A Design Plan account still has
  // money in it, and that money is what pays once the plan windows run dry — so
  // when there are windows, the balance is exactly the number a reader will want
  // next, and when there are none it is the only number there is.
  //
  // `coding-plan-usage` does not carry it, so this is its own request. A failure
  // here is not a failure of the reading: the plan figures are still valid.
  const wallet = await call({ url: `${base}/wallet/balance`, headers, timeoutMs })
  trail.push(trailEntry({ channel: 'cookie', url: `${base}/wallet/balance`, result: wallet }))
  const walletView = wallet.ok && wallet.body !== null && typeof wallet.body === 'object'
    ? {
      amount: num(wallet.body.balanceUsd),
      expiresAt: typeof wallet.body.expiresAt === 'string' && wallet.body.expiresAt !== ''
        ? wallet.body.expiresAt
        : null,
    }
    : null

  if (usage.ok) {
    const plan = parseCodingPlan(usage.body !== null && typeof usage.body === 'object'
      ? (usage.body.codingPlan ?? usage.body)
      : {})
    const amount = walletView?.amount ?? num(usage.body?.balanceUsd)
    return {
      trail,
      workspaceId,
      reading: {
        amount,
        walletExpiresAt: walletView?.expiresAt ?? null,
        windows: plan.windows,
        tier: plan.tier,
        creditsPerUsd: null,
        billing: parseSummaryBilling(usage.body) ?? parseSummaryBilling(usage.body?.codingPlan),
        endpoint: 'coding-plan-usage',
      },
    }
  }

  // The documented cookie route can refuse a valid session; the preflight route
  // is the one the controlKey path uses, so it is the honest fallback.
  const preflight = await call({ url: `${base}/billing/preflight`, headers, timeoutMs })
  trail.push(trailEntry({ channel: 'cookie', url: `${base}/billing/preflight`, result: preflight }))
  if (!preflight.ok) return { trail, workspaceId, reading: null }
  const body = preflight.body !== null && typeof preflight.body === 'object' ? preflight.body : {}
  const plan = parseCodingPlan(body.codingPlan)
  return {
    trail,
    workspaceId,
    reading: {
      amount: walletView?.amount ?? num(body.balanceUsd),
      walletExpiresAt: walletView?.expiresAt ?? null,
      windows: plan.windows,
      tier: plan.tier,
      creditsPerUsd: null,
      billing: parseSummaryBilling(preflight.body) ?? parseSummaryBilling(preflight.body?.codingPlan),
      endpoint: 'preflight',
    },
  }
}

/**
 * Aggregate one day's usage records.
 *
 * The console's usage-records page reads `billing/usage`, a cursor-paginated
 * list of billing events. There is no summary route for this channel, so the
 * total is computed here from the records themselves.
 *
 * Two figures are kept apart on purpose:
 *   - `listChargedUsd` is what the work would cost at list price;
 *   - `amountUsd` is what actually left the wallet, and it is 0 while a Design
 *     Plan covers the request.
 * Reporting only one of them would misdescribe either a plan user or a
 * pay-as-you-go user, so both travel.
 *
 * @param {unknown} entry
 * @returns {{ at: string | null, model: string, list: number, wallet: number, plan: number,
 *   input: number, output: number, cacheRead: number } | null}
 */
export function parseUsageRecord(entry) {
  if (entry === null || typeof entry !== 'object') return null
  const at = typeof entry.createdAt === 'string' && entry.createdAt !== ''
    ? entry.createdAt
    : typeof entry.consumedAt === 'string' && entry.consumedAt !== '' ? entry.consumedAt : null
  if (at === null) return null
  const input = num(entry.inputTokens) ?? 0
  const cacheRead = num(entry.cacheReadTokens) ?? 0
  return {
    at,
    initiator: typeof entry.initiator === 'string' ? entry.initiator.trim() || null : null,
    model: typeof entry.model === 'string' && entry.model !== ''
      ? entry.model
      : (typeof entry.runtime === 'string' && entry.runtime !== '' ? entry.runtime : '未知模型'),
    list: Math.abs(num(entry.listChargedUsd) ?? 0),
    wallet: Math.abs(num(entry.amountUsd) ?? 0),
    plan: Math.abs(num(entry.designPlanContribution?.amountUsd) ?? 0),
    input,
    output: num(entry.outputTokens) ?? 0,
    cacheRead,
    // What the cached tokens would have cost at the full input rate, minus what
    // they did cost. Per-record unit prices are the vendor's own, so this needs
    // no external price table. Null when the record carries no prices.
    cacheSaved: cacheSavedFor(entry, cacheRead),
  }
}

/**
 * The money served-from-cache tokens saved on one record.
 *
 * Cache reads bill at a small fraction of the input rate (0.006 vs 0.3 per
 * million on this plan), so a high cache hit rate is the difference between a
 * plan lasting hours and lasting minutes. The vendor reports both prices per
 * record, which makes this a subtraction rather than an estimate.
 * @param {object} entry one raw usage record
 * @param {number} cacheRead tokens served from cache
 * @returns {number | null} USD, or null when the record has no usable prices
 */
export function cacheSavedFor(entry, cacheRead) {
  const prices = entry?.unitPrices
  if (prices === null || typeof prices !== 'object') return null
  const inputPrice = num(prices.input)
  const cachePrice = num(prices.cacheRead)
  if (inputPrice === null || cachePrice === null) return null
  if (cacheRead <= 0) return 0
  const saved = (cacheRead * (inputPrice - cachePrice)) / 1_000_000
  return Number.isFinite(saved) && saved >= 0 ? saved : null
}

const RECENT_CALLS_LIMIT = 20

function recentCalls(records) {
  return records.slice(0, RECENT_CALLS_LIMIT).map(({ model, at, initiator }) => ({ model, at, initiator }))
}

/**
 * Fold a list of parsed records into the panel's usage block.
 * @param {object[]} records newest-first, as the endpoint returns them
 * @returns {{ today: { requests, list, wallet, plan, input, output, cacheRead },
 *   byModel: { model, requests, list, listPerRequest, input, output }[],
 *   recent: { model: string, at: string, initiator: string | null }[],
 *   first: string, last: string } | null}
 */
export function summarizeUsage(records) {
  const list = Array.isArray(records) ? records : []
  if (list.length === 0) return null
  const today = { requests: 0, list: 0, wallet: 0, plan: 0, input: 0, output: 0, cacheRead: 0, cacheSaved: 0 }
  // A record without usable prices contributes nothing to the saved total, but
  // one such record must not silently turn the total into a half-truth: it is
  // counted so the summary can say how much of the sample it covers.
  let pricedRecords = 0
  const byModel = new Map()
  for (const record of list) {
    today.requests += 1
    today.list += record.list
    today.wallet += record.wallet
    today.plan += record.plan
    today.input += record.input
    today.output += record.output
    today.cacheRead += record.cacheRead
    if (typeof record.cacheSaved === 'number') {
      today.cacheSaved += record.cacheSaved
      pricedRecords += 1
    }
    const bucket = byModel.get(record.model) ?? { model: record.model, requests: 0, list: 0, input: 0, output: 0 }
    bucket.requests += 1
    bucket.list += record.list
    bucket.input += record.input
    bucket.output += record.output
    byModel.set(record.model, bucket)
  }
  const rows = [...byModel.values()]
    .map((row) => ({ ...row, listPerRequest: row.requests > 0 ? row.list / row.requests : 0 }))
    .sort((left, right) => right.list - left.list)
  return {
    today: { ...today, cacheSavedComplete: pricedRecords === list.length },
    byModel: rows,
    recent: recentCalls(list),
    // Records arrive newest-first, so the first is the most recent event.
    first: list[0].at,
    last: list[list.length - 1].at,
  }
}

/**
 * Read one day of billing usage through the browser-session channel.
 *
 * The recent list may cross midnight, while usage totals only include the
 * requested day. Both views share the same capped upstream requests.
 * @param {object} input
 * @param {string} input.cookie
 * @param {string} input.workspaceId
 * @param {number} input.timeoutMs
 * @param {string} [input.day] ISO date (YYYY-MM-DD); defaults to today
 * @param {number} [input.maxPages]
 * @returns {Promise<{ usage: object | null, failure: object | null, trail: object[] }>}
 */
export async function readUsageRecords(input, request = call) {
  const trail = []
  const day = typeof input.day === 'string' && input.day !== '' ? input.day : new Date().toISOString().slice(0, 10)
  const maxPages = Number.isFinite(input.maxPages) ? input.maxPages : 2
  const headers = consoleHeaders(input.cookie)
  const base = `${API}/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/billing/usage`

  const records = []
  const latest = []
  let reachedEarlierDay = false
  let cursor = null
  let pages = 0
  let truncated = false
  let failure = null

  while (pages < maxPages) {
    const query = `?limit=100${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`
    const page = await request({ url: `${base}${query}`, headers, timeoutMs: input.timeoutMs })
    pages += 1
    trail.push(trailEntry({ channel: 'cookie', url: `${base}?limit=100`, result: page, note: page.ok ? `usage p${pages}` : page.kind }))
    if (!page.ok) {
      failure = page
      break
    }

    const entries = Array.isArray(page.body?.entries) ? page.body.entries : []
    for (const entry of entries) {
      const record = parseUsageRecord(entry)
      if (record === null) continue
      if (latest.length < RECENT_CALLS_LIMIT) latest.push(record)
      const recordDay = record.at.slice(0, 10)
      if (recordDay === day) records.push(record)
      if (recordDay < day) reachedEarlierDay = true
    }
    if (reachedEarlierDay && latest.length >= RECENT_CALLS_LIMIT) break
    if (page.body?.hasMore !== true || typeof page.body?.nextCursor !== 'string') break
    if (pages >= maxPages) {
      truncated = !reachedEarlierDay
      break
    }
    cursor = page.body.nextCursor
  }

  const summary = summarizeUsage(records)
  const usage = failure !== null && latest.length === 0 ? null : {
    day,
    truncated,
    records: records.length,
    ...summary,
    recent: recentCalls(latest),
  }
  return { usage, failure, trail }
}

/**
 * Read the account snapshot.
 *
 * @param {object} deps
 * @param {'auto'|'control'|'cookie'} [deps.source]
 * @param {string | null} [deps.controlKey]
 * @param {string | null} [deps.cookie]
 * @param {string | null} [deps.workspaceId]
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<object>} a Reading
 */
export async function read(deps) {
  const source = deps?.source ?? 'auto'
  const controlKey = typeof deps?.controlKey === 'string' ? deps.controlKey.trim() : ''
  const cookie = typeof deps?.cookie === 'string' ? deps.cookie.trim() : ''
  const timeoutMs = Number.isFinite(deps?.timeoutMs) ? deps.timeoutMs : 12000
  const queriedAt = Date.now()

  const wantCookie = source === 'cookie' || source === 'auto'
  const wantControl = source === 'control' || source === 'auto'
  const trail = []

  if (!wantCookie && !wantControl) {
    return {
      provider: PROVIDER,
      status: 'no-credential',
      identity: null,
      money: null,
      windows: [],
      usage: null,
      trail: [{ channel: 'config', url: null, httpStatus: null, ms: 0, result: `未知来源：${String(source)}` }],
      message: `来源设置无法识别：${String(source)}`,
      queriedAt,
    }
  }

  let cookieOutcome = null
  if (wantCookie) {
    if (cookie === '') {
      trail.push({ channel: 'cookie', url: null, httpStatus: null, ms: 0, result: 'skipped: 没有浏览器登录态' })
    } else {
      const probe = await verifySession(cookie, timeoutMs)
      trail.push(trailEntry({ channel: 'cookie', url: `${API}/api/auth/get-session`, result: probe.result, note: probe.ok ? 'session ok' : 'session missing' }))
      if (probe.ok) {
        cookieOutcome = await readCookie(cookie, timeoutMs, deps?.workspaceId ?? null)
        trail.push(...cookieOutcome.trail)
      }
    }
  }

  let controlOutcome = null
  if (wantControl) {
    if (controlKey === '') {
      trail.push({ channel: 'control', url: null, httpStatus: null, ms: 0, result: 'skipped: 没有 controlKey' })
    } else {
      controlOutcome = await readControl(controlKey, timeoutMs)
      trail.push(...controlOutcome.trail)
    }
  }

  // Prefer whichever channel produced plan windows; then any reading at all.
  const candidates = [
    cookieOutcome?.reading === null || cookieOutcome?.reading === undefined
      ? null
      : { ...cookieOutcome.reading, channel: 'cookie' },
    controlOutcome?.reading === null || controlOutcome?.reading === undefined
      ? null
      : { ...controlOutcome.reading, channel: 'control' },
  ].filter(Boolean)

  if (candidates.length === 0) {
    const unauthorized = trail.some((entry) => entry.httpStatus === 401 || entry.httpStatus === 403)
    const network = trail.every((entry) => entry.result === 'network-error')
    const identity = controlKey === '' ? null : keyIdentity(controlKey)
    return {
      provider: PROVIDER,
      status: unauthorized ? 'unauthorized' : network ? 'network-error' : 'no-credential',
      identity,
      money: null,
      windows: [],
      usage: null,
      trail,
      message: unauthorized
        ? 'OpenDesign 拒绝了当前凭据（HTTP 401/403）。重新登录或换一把 controlKey。'
        : network
          ? '连不上 OpenDesign 控制面。'
          : '没有可用的 OpenDesign 凭据。登录后或填入 controlKey 再看。',
      queriedAt,
    }
  }

  const withWindows = candidates.find((entry) => entry.windows.length > 0)
  const chosen = withWindows ?? candidates[0]
  const identity = chosen.channel === 'control'
    ? keyIdentity(controlKey)
    : { label: '浏览器会话', tail: cookie.slice(-4), vipLevel: null }

  // The usage page is a browser-session view: the same cookie that renders it is
  // the only credential that may read it, so this read is attempted only when a
  // session is present and only after the plan snapshot succeeded.
  //
  // The workspace must come from the *cookie* channel. The controlKey and the
  // browser session can belong to different accounts — on this machine they do —
  // and reading one account's records with another account's workspace id simply
  // returns zero rows, which would look like "no usage today".
  let usage = chosen.usage ?? null
  let usageError = null
  let billing = chosen.billing ?? null
  const cookieWorkspace = cookieOutcome?.workspaceId ?? deps?.workspaceId ?? null
  const summaryUrl = `${API}/api/v1/billing/summary`
  const [usageRead, cookieSummary] = await Promise.all([
    cookie !== '' && cookieWorkspace !== null
      ? readUsageRecords({ cookie, workspaceId: cookieWorkspace, timeoutMs, maxPages: 2 })
      : null,
    chosen.channel === 'cookie' && billing?.periodEnd == null
      ? call({ url: summaryUrl, headers: consoleHeaders(cookie), timeoutMs })
      : null,
  ])
  if (usageRead !== null) {
    trail.push(...usageRead.trail)
    if (usageRead.usage !== null) usage = usageRead.usage
    if (usageRead.failure !== null) {
      usageError = usageRead.failure.kind === 'rate-limited'
        ? '用量记录读得太频繁，OpenDesign 限流了。稍后再刷新。'
        : usageRead.failure.kind === 'unauthorized'
          ? '浏览器会话无权读取用量记录，可能已过期。'
          : `用量记录读取失败（HTTP ${usageRead.failure.status ?? '—'}）。`
    }
  }
  if (cookieSummary !== null) {
    trail.push(trailEntry({ channel: 'cookie', url: summaryUrl, result: cookieSummary }))
    if (cookieSummary.ok) billing = parseSummaryBilling(cookieSummary.body) ?? billing
  }

  return {
    provider: PROVIDER,
    status: 'ok',
    identity,
    money: typeof chosen.amount === 'number'
      ? {
        amount: chosen.amount,
        currency: 'USD',
        // A plan account still holds wallet money. Labelling it "wallet" only
        // when no windows exist hides the balance from exactly the reader who
        // needs it: the one whose windows are nearly empty.
        kind: chosen.windows.length > 0 ? 'plan' : 'wallet',
        expiresAt: chosen.walletExpiresAt ?? null,
      }
      : null,
    windows: chosen.windows,
    usage,
    billing,
    tier: chosen.tier ?? null,
    creditsPerUsd: chosen.creditsPerUsd ?? null,
    periodEnd: billing?.periodEnd ?? chosen.periodEnd ?? null,
    channel: chosen.channel,
    endpoint: chosen.endpoint,
    workspaceId: controlOutcome?.workspace?.id ?? cookieOutcome?.workspaceId ?? deps?.workspaceId ?? null,
    trail,
    usageError,
    message: chosen.windows.length === 0
      ? '该账号当前没有 Design Plan 窗口，只显示钱包余额。'
      : null,
    queriedAt,
  }
}

/** One line naming where the numbers came from. */
export function sourceLine(reading) {
  if (!reading || reading.status !== 'ok') return null
  const identity = reading.identity
  const who = identity === null ? '未知凭据' : `${identity.label}${identity.tail ? ` · ${identity.tail}` : ''}`
  const where = reading.channel ? ` · ${reading.channel}/${reading.endpoint}` : ''
  return `${LABEL} · ${who}${where}`
}
