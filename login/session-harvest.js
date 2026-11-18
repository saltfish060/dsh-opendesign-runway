/**
 * Interactive OpenDesign sign-in: a throwaway browser, a human login, and a
 * verification that means the same thing the console means.
 *
 * The previous implementation guessed which cookie carried the session (a name
 * containing "session", on an `open-design.ai` domain). Measured on this machine
 * that guess never matched: the console authenticates against
 * `amr-api.open-design.ai/api/auth/*`, and its session is only observable by
 * asking that service. So this version does not guess:
 *
 *   1. open the console's login page in a fresh profile;
 *   2. harvest every cookie over CDP, grouped by domain;
 *   3. ask `GET /api/auth/get-session` with them;
 *   4. persist only when that call returns a session id.
 *
 * The page title carries the current step, so the person waiting in the window
 * can see that the plugin is working and what it is waiting for. A cookie value
 * never appears in a status message, a log line, or an error.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { verifySession } from '../adapters/opendesign.js'

/** Chrome/Edge install paths, first that exists wins. */
export const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
export const CDP_CONNECT_TIMEOUT_MS = 45 * 1000
export const HARVEST_INTERVAL_MS = 2000
export const LOGIN_PAGE_URL = 'https://open-design.ai/cloud/login'
/** Domains whose cookies may be sent to the console API. */
export const COOKIE_DOMAIN_HINTS = ['open-design.ai']

/** One line of error text, safe to display. */
function describe(error) {
  const message = error instanceof Error && error.message ? error.message : String(error)
  return message.split('\n')[0].slice(0, 240)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The first installed browser, or null. */
export function findBrowser(exists = existsSync) {
  return BROWSER_CANDIDATES.find((candidate) => exists(candidate)) ?? null
}

/**
 * Whether the sign-in window can be seen at all.
 *
 * The window opens on the host's screen, so a GUI driven from another machine
 * would start a flow nobody can complete. Reporting that up front is better than
 * a five-minute timeout.
 */
export function loginAvailability(input = {}) {
  if (input.remote === true || input.lanBind === true) {
    return {
      available: false,
      reason: '临时登录窗口会开在运行 DSH 的这台电脑上，你现在是远程访问，看不到它。请在本机打开界面后再登录。',
    }
  }
  return { available: true, reason: null }
}

/** Whether a request reached this host through a non-loopback address. */
export function isRemoteAuthority(request) {
  try {
    const header = request?.headers?.get?.('host')
    const authority = typeof header === 'string' && header !== '' ? header : new URL(request.url).host
    const bare = authority.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
    return !['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(bare)
  } catch {
    return false
  }
}

/**
 * Build a Cookie header from a CDP cookie list.
 *
 * Only cookies for the console's own domains travel: the throwaway profile can
 * also hold unrelated host cookies, and sending those to the console would leak
 * them to a third party.
 */
export function cookieHeaderFrom(cookies) {
  const pairs = []
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    if (cookie === null || typeof cookie !== 'object') continue
    const domain = typeof cookie.domain === 'string' ? cookie.domain.replace(/^\./, '').toLowerCase() : ''
    if (!COOKIE_DOMAIN_HINTS.some((hint) => domain.endsWith(hint))) continue
    if (typeof cookie.name !== 'string' || cookie.name === '') continue
    if (typeof cookie.value !== 'string') continue
    pairs.push(`${cookie.name}=${cookie.value}`)
  }
  return pairs.join('; ')
}

/** A free loopback port, reserved and released. */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address !== null && typeof address === 'object' ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('无法分配调试端口'))))
    })
  })
}

/** A minimal CDP client over one target's WebSocket. */
async function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl)
  const pending = new Map()
  let nextId = 1
  let closed = false

  socket.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    } catch {
      return
    }
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined && message.error !== null) {
      entry.reject(new Error(typeof message.error.message === 'string' ? message.error.message : 'CDP 调用失败'))
    } else {
      entry.resolve(message.result)
    }
  })
  socket.addEventListener('close', () => {
    closed = true
    for (const entry of pending.values()) entry.reject(new Error('CDP 连接已关闭'))
    pending.clear()
  })

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP 握手超时')), 15_000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(undefined) }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP 连接失败')) }, { once: true })
  })

  return {
    send(method, params = {}, timeoutMs = 15_000) {
      if (closed) return Promise.reject(new Error('CDP 连接已关闭'))
      return new Promise((resolve, reject) => {
        const id = nextId++
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)) }, timeoutMs)
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value) },
          reject: (error) => { clearTimeout(timer); reject(error) },
        })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() {
      try { socket.close() } catch {}
    },
  }
}

/** The browser's first page target. */
async function waitForPageTarget(port, deadline) {
  const endpoint = `http://127.0.0.1:${port}/json/list`
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(2000) })
      if (response.ok) {
        const targets = await response.json()
        const page = Array.isArray(targets)
          ? targets.find((target) => target !== null && typeof target === 'object'
            && target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string')
          : undefined
        if (page !== undefined) return page
      }
    } catch {}
    await delay(300)
  }
  throw new Error('浏览器没有开放调试通道')
}

/**
 * Create the sign-in controller: one flow per host process.
 *
 * @param {object} input
 * @param {(cookie: string) => Promise<{ ok: boolean, message?: string }>} input.verify
 * @param {(session: { cookie: string }) => Promise<void>} input.onSuccess
 * @param {{ lanBind?: boolean, remote?: boolean } | (() => { lanBind?: boolean, remote?: boolean })} [input.deployment]
 * @param {{ exists?: (path: string) => boolean, spawn?: typeof spawn, now?: () => number }} [input.io]
 */
export function createLoginFlow(input) {
  const io = input.io ?? {}
  const exists = typeof io.exists === 'function' ? io.exists : existsSync
  const spawnImpl = typeof io.spawn === 'function' ? io.spawn : spawn
  const now = typeof io.now === 'function' ? io.now : Date.now
  const deploymentOf = (getter) => {
    if (typeof getter === 'function') {
      try { return getter() ?? {} } catch { return {} }
    }
    return getter ?? {}
  }

  const state = { status: { state: 'idle' }, flow: null, generation: 0 }

  function setStatus(next) {
    state.status = { ...next, updatedAt: now() }
    return { ...state.status }
  }

  function loginStatus() {
    return { ...state.status }
  }

  function makeResources() {
    return { child: null, cdp: null, profileDir: null, cancelled: false, generation: state.generation, teardown: null }
  }

  async function release(resources) {
    if (resources === null) return
    if (resources.teardown !== null) return resources.teardown
    resources.teardown = (async () => {
      if (resources.cdp !== null) {
        try { await resources.cdp.send('Browser.close', {}, 5000) } catch {}
        resources.cdp.close()
        resources.cdp = null
      }
      const child = resources.child
      if (child !== null && child !== undefined) {
        for (let i = 0; i < 20; i += 1) {
          if (child.exitCode !== null || child.killed) break
          await delay(100)
        }
        if (child.exitCode === null && child.killed !== true) {
          try { child.kill('SIGKILL') } catch {}
          if (typeof child.pid === 'number' && process.platform === 'win32') {
            try { spawnImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {}
          }
        }
        resources.child = null
      }
      const dir = resources.profileDir
      if (typeof dir === 'string' && dir !== '') {
        for (let i = 0; i < 10; i += 1) {
          try { rmSync(dir, { recursive: true, force: true }); break } catch { await delay(250) }
        }
        resources.profileDir = null
      }
    })()
    return resources.teardown
  }

  async function run(resources) {
    const generation = resources.generation
    const write = (next) => (state.generation === generation ? setStatus(next) : loginStatus())

    const browser = findBrowser(exists)
    if (browser === null) {
      return write({ state: 'failed', message: '没有找到 Chrome 或 Edge。' })
    }
    const availability = loginAvailability(deploymentOf(input.deployment))
    if (!availability.available) return write({ state: 'failed', message: availability.reason })

    write({ state: 'starting', message: '正在打开登录窗口…' })
    let port
    try {
      port = await findFreePort()
    } catch (error) {
      return write({ state: 'failed', message: describe(error) })
    }
    if (resources.cancelled) return write({ state: 'idle', message: '已取消。' })

    const profileDir = join(tmpdir(), `quota-lens-login-${randomBytes(6).toString('hex')}`)
    try {
      mkdirSync(profileDir, { recursive: true })
    } catch (error) {
      return write({ state: 'failed', message: `无法创建临时目录：${describe(error)}` })
    }
    resources.profileDir = profileDir

    let child
    try {
      child = spawnImpl(browser, [
        `--remote-debugging-port=${port}`,
        '--remote-allow-origins=*',
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        LOGIN_PAGE_URL,
      ], { stdio: 'ignore', windowsHide: false })
    } catch (error) {
      return write({ state: 'failed', message: `无法启动浏览器：${describe(error)}` })
    }
    resources.child = child
    let exited = false
    child.on('exit', () => { exited = true })

    let page
    try {
      page = await waitForPageTarget(port, now() + CDP_CONNECT_TIMEOUT_MS)
    } catch (error) {
      if (resources.cancelled) return write({ state: 'idle', message: '已取消。' })
      return write({
        state: 'failed',
        message: exited ? '浏览器启动后立刻退出了。它可能已经在运行，或不允许远程调试。' : describe(error),
      })
    }
    if (resources.cancelled) return write({ state: 'idle', message: '已取消。' })

    try {
      resources.cdp = await connectCdp(page.webSocketDebuggerUrl)
    } catch (error) {
      return write({ state: 'failed', message: `无法连接登录窗口：${describe(error)}` })
    }

    const deadline = now() + LOGIN_TIMEOUT_MS
    let lastNote = ''
    let polls = 0

    write({ state: 'pending', message: '请在这个窗口里登录 OpenDesign。' })
    while (now() < deadline) {
      if (resources.cancelled) return write({ state: 'idle', message: '已取消。' })
      if (exited) return write({ state: 'failed', message: '登录窗口被关闭了，本次登录没有完成。' })
      polls += 1

      // Tell the person in the window what is happening; a title is the only
      // surface a throwaway profile can rely on.
      try {
        await resources.cdp.send('Runtime.evaluate', {
          expression: `document.title = ${JSON.stringify(`[quota-lens] 等待登录… ${polls}`)}`,
          returnByValue: true,
        }, 4000)
      } catch {}

      let cookies = []
      try {
        const result = await resources.cdp.send('Storage.getCookies', {}, 8000)
        cookies = Array.isArray(result?.cookies) ? result.cookies : []
      } catch (error) {
        lastNote = describe(error)
      }

      const cookie = cookieHeaderFrom(cookies)
      if (cookie !== '') {
        write({ state: 'pending', message: '检测到登录态，正在验证…' })
        let verdict
        try {
          verdict = await input.verify(cookie)
        } catch (error) {
          lastNote = describe(error)
          verdict = { ok: false, message: lastNote }
        }
        if (verdict?.ok === true) {
          try {
            await input.onSuccess({ cookie })
          } catch (error) {
            return write({ state: 'failed', message: `登录成功但保存失败：${describe(error)}` })
          }
          return write({ state: 'success', message: '登录完成，浏览器已自动关闭。' })
        }
        lastNote = verdict?.message ?? '接口还没有确认登录态。'
        write({ state: 'pending', message: `登录态尚未生效（${lastNote}），继续等待…` })
      }

      await delay(HARVEST_INTERVAL_MS)
    }

    return write({
      state: 'failed',
      message: lastNote === ''
        ? '超时：5 分钟内没有完成登录。'
        : `超时：5 分钟内没有完成登录（最后一步：${lastNote}）。`,
    })
  }

  return {
    loginStatus,

    /** Start one flow; an in-progress flow is reported, not restarted. */
    async startLogin() {
      if (state.flow !== null) return loginStatus()
      const resources = makeResources()
      state.flow = resources
      state.generation += 1
      resources.generation = state.generation
      setStatus({ state: 'starting', message: '正在准备登录窗口…' })
      void (async () => {
        try {
          await run(resources)
        } catch (error) {
          if (state.generation === resources.generation) setStatus({ state: 'failed', message: describe(error) })
        } finally {
          await release(resources)
          if (state.flow === resources) state.flow = null
        }
      })()
      return { ...state.status }
    },

    async cancelLogin() {
      const resources = state.flow
      if (!resources) return loginStatus()
      resources.cancelled = true
      state.generation += 1
      setStatus({ state: 'idle', message: '已取消，正在关闭窗口。' })
      await release(resources)
      if (state.flow === resources) state.flow = null
      return { ...state.status }
    },

    async dispose() {
      const resources = state.flow
      if (!resources) return
      resources.cancelled = true
      state.generation += 1
      await release(resources)
      if (state.flow === resources) state.flow = null
    },
  }
}

/** The verifier this module uses by default: the console's own session call. */
export function defaultVerifier(fetchTimeoutMs = 12000) {
  return async (cookie) => {
    const verdict = await verifySession(cookie, fetchTimeoutMs)
    if (verdict.ok) return { ok: true }
    const status = verdict.result.status
    if (status === 401 || status === 403) return { ok: false, message: `会话被拒绝（HTTP ${status}）` }
    if (status === null) return { ok: false, message: `连不上认证服务（${describe(verdict.result.error)}）` }
    return { ok: false, message: `认证服务返回 HTTP ${status}` }
  }
}
