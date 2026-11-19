/**
 * Process-local reading store.
 *
 * Nothing here is persisted: a quota figure is only meaningful for the minute it
 * was read, and a stale number surviving a restart is worse than a fresh failure.
 * Two things besides the last reading are kept on purpose:
 *
 *   - the last *two* successful sample points, which is what makes a burn-rate
 *     estimate possible without inventing history;
 *   - the cooldown stamp, so a failing vendor is not re-queried on every poll.
 */

/** @returns {number} epoch milliseconds */
function nowMs() {
  return Date.now()
}

/**
 * @param {object} [options]
 * @param {number} [options.minIntervalMs] floor between two real requests
 * @param {number} [options.cooldownMs] how long a failure suppresses retries
 * @param {() => number} [options.now]
 */
export function createStore(options = {}) {
  const minIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : 60_000
  const cooldownMs = Number.isFinite(options.cooldownMs) ? options.cooldownMs : 300_000
  const now = typeof options.now === 'function' ? options.now : nowMs

  /** @type {Map<string, object>} */
  const readings = new Map()
  /** @type {Map<string, {at: number, amount: number}[]>} */
  const samples = new Map()
  /** @type {Map<string, number>} */
  const failedAt = new Map()
  /** @type {Map<string, Promise<object>>} */
  const inFlight = new Map()

  const keyOf = (provider) => (typeof provider === 'string' && provider !== '' ? provider : 'default')

  return {
    /** The last reading for one provider, or a synthetic empty state. */
    get(provider) {
      const key = keyOf(provider)
      return readings.get(key) ?? { provider, status: 'no-reading', message: '还没有读过。' }
    },

    /**
     * Record one successful reading.
     *
     * Only an `ok` reading with a usable amount becomes a burn-rate sample: a
     * failure says nothing about consumption, and mixing the two would fabricate
     * a rate.
     */
    recordSuccess(provider, reading) {
      const key = keyOf(provider)
      readings.set(key, reading)
      failedAt.delete(key)
      const amount = reading?.money?.amount
      if (typeof amount === 'number' && Number.isFinite(amount)) {
        const series = samples.get(key) ?? []
        series.push({ at: now(), amount })
        // Two points suffice; keep a couple spare so an outlier can be dropped.
        while (series.length > 4) series.shift()
        samples.set(key, series)
      }
    },

    /** Record one failure, arming the cooldown. */
    recordFailure(provider, reading) {
      const key = keyOf(provider)
      readings.set(key, reading)
      failedAt.set(key, now())
    },

    /** Whether an automatic refresh may become a real request now. */
    mayAutoRefresh(provider, requestedIntervalMs = minIntervalMs) {
      const key = keyOf(provider)
      const reading = readings.get(key)
      const stamp = failedAt.get(key)
      if (stamp !== undefined && now() - stamp < cooldownMs) return false
      // The interval paces *successful* reads. A failed read is paced by the
      // cooldown instead, so retrying right after the cooldown expires is the
      // whole point of having one.
      if (reading?.status !== 'ok') return true
      const at = Number(reading.queriedAt)
      if (!Number.isFinite(at)) return true
      return now() - at >= Math.max(minIntervalMs, requestedIntervalMs)
    },

    /** Discard a previous account's reading and detach its outstanding request. */
    invalidate(provider) {
      const key = keyOf(provider)
      readings.delete(key)
      samples.delete(key)
      failedAt.delete(key)
      inFlight.delete(key)
    },

    /** Drop the cooldown so an explicit refresh is not held back. */
    clearCooldown(provider) {
      failedAt.delete(keyOf(provider))
    },

    /**
     * Estimate the daily consumption from the retained samples.
     *
     * Returns null unless there are at least two usable points with a positive
     * time delta; a single reading cannot describe a rate, and saying so is the
     * honest answer.
     * @param {string} provider
     * @returns {{ perDay: number, from: number, to: number } | null}
     */
    burnRate(provider) {
      const series = samples.get(keyOf(provider)) ?? []
      if (series.length < 2) return null
      const first = series[0]
      const last = series[series.length - 1]
      const seconds = (last.at - first.at) / 1000
      if (!Number.isFinite(seconds) || seconds <= 0) return null
      const delta = first.amount - last.amount
      // A negative delta (top-up) is not a burn rate.
      if (!Number.isFinite(delta) || delta <= 0) return null
      return { perDay: (delta / seconds) * 86_400, from: first.at, to: last.at }
    },

    /** Collapse concurrent callers onto one request. */
    coalesce(provider, run) {
      const key = keyOf(provider)
      const existing = inFlight.get(key)
      if (existing !== undefined) return existing
      const promise = Promise.resolve()
        .then(run)
        .finally(() => {
          if (inFlight.get(key) === promise) inFlight.delete(key)
        })
      inFlight.set(key, promise)
      return promise
    },
  }
}
