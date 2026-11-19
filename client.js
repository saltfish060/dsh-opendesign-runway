/**
 * dsh-opendesign-runway — browser half.
 *
 * Two surfaces:
 *   - `conversation.input.right` — a compact pill that opens a detail panel.
 *     It appears only while the session's model belongs to OpenDesign.
 *   - `settings.section` — credentials only: sign in, paste a cookie, clear it.
 *
 * Styling decisions that are load-bearing, each one learned by measuring the
 * actual theme this runs under (catppuccin latte/mocha):
 *
 *   1. `--dsw-alias-bg-layer-4` and `--dsw-alias-bg-elevated` **do not exist**.
 *      A declaration that names them drops the whole `background` shorthand, so
 *      the panel renders transparent over the transcript. Only layer-1..3 exist,
 *      and in the light theme all three resolve to the same #eff1f5 as the page —
 *      a layer token therefore gives zero separation there.
 *      Elevation is produced with `color-mix` against `label-primary` instead,
 *      which moves the surface *away* from the page colour in both themes.
 *
 *   2. Every animation goes in the injected stylesheet: inline `style` cannot
 *      express `:hover`, `:focus-visible`, `@keyframes` or `prefers-reduced-motion`.
 *
 *   3. Motion follows one language: 160–200ms, `cubic-bezier(.23,1,.32,1)`,
 *      transform/opacity only. The bars animate `scaleX`, not `width`, so they
 *      stay on the compositor.
 */

window.__ModuleLoader__.load({
  id: 'dsh-opendesign-runway',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Provider aliases this plugin answers, matching the host half. */
    const PROVIDERS = ['opendesign', 'open-design', 'open_design']
    const PROVIDER_LABEL = 'OpenDesign'

    const PATHS = {
      snapshot: '/api/opendesign-runway/snapshot',
      login: '/api/opendesign-runway/login',
      credential: '/api/opendesign-runway/credential',
      logout: '/api/opendesign-runway/logout',
    }

    const POLL_MS = 30_000
    const LOGIN_POLL_MS = 1500
    const DASHBOARD = 'https://open-design.ai/cloud/dashboard'

    /** One motion language: strong ease-out, 160–200ms. */
    const CSS = `
.ql-root{position:relative;display:inline-flex;min-width:0}

/* ── pill ─────────────────────────────────────────────────────────────── */
.ql-pill{
  display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;
  border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:transparent;
  color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;
  cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;
  transition:background-color 160ms cubic-bezier(.23,1,.32,1),
             border-color 160ms cubic-bezier(.23,1,.32,1),
             transform 160ms cubic-bezier(.23,1,.32,1);
}
.ql-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ql-pill:active{transform:scale(.97)}
.ql-pill[aria-expanded="true"]{border-color:var(--dsw-alias-brand-primary)}
.ql-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}

.ql-label{font-variant-numeric:tabular-nums;white-space:nowrap;letter-spacing:-.01em}

/* The plain status dot, offered as an alternative indicator. */
.ql-dot{width:6px;height:6px;border-radius:50%;flex:none;
  background:var(--dsw-alias-state-business-primary);
  transition:background-color 320ms cubic-bezier(.23,1,.32,1)}
.ql-dot.is-warn{background:var(--dsw-alias-state-warn-primary)}
.ql-dot.is-low{background:var(--dsw-alias-state-error-primary)}
.ql-dot.is-idle{background:var(--dsw-alias-label-tertiary)}

/* Circular progress: the ring replaces the solid status dot. The arc animates
   its dash offset, which is a paint-only change — no layout, no reflow. */
.ql-ring{flex:none;display:block;overflow:visible;
  color:var(--dsw-alias-state-business-primary);
  transition:color 320ms cubic-bezier(.23,1,.32,1)}
.ql-ring.is-warn{color:var(--dsw-alias-state-warn-primary)}
.ql-ring.is-low{color:var(--dsw-alias-state-error-primary)}
.ql-ring.is-idle{color:var(--dsw-alias-label-tertiary)}
.ql-ring-track{opacity:.22}
.ql-ring-fill{transition:stroke-dashoffset 620ms cubic-bezier(.22,1,.36,1)}

/* A stale-but-usable reading: visible, quiet, never mistaken for current. */
.ql-stale{flex:none;padding:1px 6px;border-radius:999px;font-size:10.5px;
  border:.5px solid var(--dsw-alias-border-l3);
  color:var(--dsw-alias-state-warn-label);
  animation:ql-stale-in 300ms cubic-bezier(.23,1,.32,1) both}
@keyframes ql-stale-in{from{opacity:0}to{opacity:1}}

/* Display-mode chooser: small chips, one selected. */
.ql-modes{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-start}
.ql-mode{
  height:26px;padding:0 11px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;
  background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;
  white-space:nowrap;
  cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;
  transition:background-color 160ms cubic-bezier(.23,1,.32,1),
             color 160ms cubic-bezier(.23,1,.32,1),
             border-color 160ms cubic-bezier(.23,1,.32,1),
             transform 160ms cubic-bezier(.23,1,.32,1);
}
.ql-mode:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.ql-mode:active{transform:scale(.97)}
.ql-mode:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ql-mode.is-on{
  color:var(--dsw-alias-label-primary);
  border-color:var(--dsw-alias-brand-primary);
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
}

/* ── panel ────────────────────────────────────────────────────────────── */
.ql-panel{
  position:absolute;bottom:38px;right:0;z-index:60;
  width:min(336px,calc(100vw - 32px));max-height:min(70vh,560px);overflow-y:auto;
  overscroll-behavior:contain;scrollbar-width:thin;
  box-sizing:border-box;padding:13px;
  display:flex;flex-direction:column;gap:9px;
  border:.5px solid var(--dsw-alias-border-l3);border-radius:14px;
  /* Elevation: lift the surface away from the page, whichever way that is. */
  background:var(--dsw-alias-bg-layer-3);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 94%, var(--dsw-alias-label-primary) 6%);
  box-shadow:0 16px 40px rgba(0,0,0,.26),0 2px 8px rgba(0,0,0,.14);
  color:var(--dsw-alias-label-primary);font-size:12.5px;
  transform-origin:bottom right;
  animation:ql-panel-in 200ms cubic-bezier(.23,1,.32,1) both;
}
@keyframes ql-panel-in{
  from{opacity:0;transform:translateY(8px) scale(.96)}
  to{opacity:1;transform:none}
}
/* Direct children rise in sequence: the panel arrives as a whole, its blocks
   follow by 24ms each. Stagger is short so nothing feels slow. */
.ql-panel > *{animation:ql-block-in 260ms cubic-bezier(.23,1,.32,1) both}
.ql-panel > *:nth-child(1){animation-delay:30ms}
.ql-panel > *:nth-child(2){animation-delay:54ms}
.ql-panel > *:nth-child(3){animation-delay:78ms}
.ql-panel > *:nth-child(4){animation-delay:102ms}
.ql-panel > *:nth-child(5){animation-delay:126ms}
.ql-panel > *:nth-child(n+6){animation-delay:150ms}
@keyframes ql-block-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}

.ql-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.ql-title{font-size:13px;font-weight:600;letter-spacing:-.005em;white-space:nowrap}
.ql-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;
  overflow-wrap:anywhere}
.ql-sub.is-truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── account rows ─────────────────────────────────────────────────────── */
/* Plan tier and wallet: two facts about the account, stacked under the gauges.
   One column of labels, one column of values, a hairline above. No card, no
   badge — the numbers are small and the gauges are the subject. */
.ql-meta{display:flex;flex-direction:column;gap:2px;padding-top:9px;
  border-top:.5px solid var(--dsw-alias-border-l2)}

/* ── rows ─────────────────────────────────────────────────────────────── */
.ql-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-height:21px;min-width:0}
.ql-k{color:var(--dsw-alias-label-tertiary);min-width:0;overflow-wrap:anywhere;font-size:12px}
.ql-v{font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;font-size:12px}
.ql-v.is-strong{font-weight:600;font-size:13px}

/* ── windows ──────────────────────────────────────────────────────────── */
/* Tight: two windows must fit without the panel feeling like a form. */
.ql-wins{display:flex;flex-direction:column;gap:13px}
.ql-win{display:flex;flex-direction:column;gap:3px;
  animation:ql-row-in 220ms cubic-bezier(.23,1,.32,1) both;
  animation-delay:calc(var(--ql-i,0) * 40ms)}
@keyframes ql-row-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

.ql-win-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.ql-win-name{color:var(--dsw-alias-label-secondary);font-size:12px;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ql-win-pct{font-variant-numeric:tabular-nums;font-size:12px;font-weight:600;flex:none}

/* Absolute credits and the reset moment share one supporting line. */
.ql-win-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;
  font-variant-numeric:tabular-nums;letter-spacing:.01em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* The rate outlook: one line, quiet unless it is warning. */
.ql-outlook{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);
  overflow-wrap:anywhere}
.ql-outlook.is-warn{color:var(--dsw-alias-state-warn-label)}

.ql-bar{position:relative;height:6px;border-radius:999px;overflow:hidden;
  background:var(--dsw-alias-bg-skeleton)}
.ql-bar-fill{position:absolute;inset:0;border-radius:999px;transform-origin:left center;
  transition:transform 620ms cubic-bezier(.22,1,.36,1);
  /* A faint sheen makes the fill read as a gauge, not a flat rectangle. */
  background-image:linear-gradient(90deg,rgba(255,255,255,.22),rgba(255,255,255,0) 55%)}
.ql-bar-fill.is-ok{background-color:var(--dsw-alias-state-business-primary)}
.ql-bar-fill.is-warn{background-color:var(--dsw-alias-state-warn-primary)}
.ql-bar-fill.is-low{background-color:var(--dsw-alias-state-error-primary)}

/* The settings page draws its bars on arrival: the fill grows from the left as
   the section mounts. A quota bar is the one element there worth a flourish, and
   it is seen once per visit rather than on every open.
   Both the scale and the wipe run from the same custom property, so an updated
   percentage retargets without replaying the entrance. */
@keyframes ql-grow-in{
  from{transform:scaleX(0)}
  to{transform:scaleX(var(--ql-pct,1))}
}
.ql-bar-fill.is-grow{
  transform:scaleX(var(--ql-pct,1));
  animation:ql-grow-in 520ms cubic-bezier(.22,1,.36,1) both;
  animation-delay:calc(var(--ql-i,0) * 90ms + 120ms)
}

/* ── misc ─────────────────────────────────────────────────────────────── */
.ql-sep{height:.5px;background:var(--dsw-alias-border-l2);margin:3px 0}

/* The lower half is deliberately compact: one tight column, no stat grid.
   Type is one step up from before — 11px Chinese text on a translucent surface
   reads thin, and 12–12.5px still fits two call rows without the block growing. */
.ql-tail{display:flex;flex-direction:column;gap:7px}

.ql-tokrow{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.ql-tok-k{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1}
.ql-tok-v{font-size:16px;font-weight:650;line-height:1;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}

.ql-calls{display:flex;flex-direction:column;gap:2px}
.ql-calls-cap{color:var(--dsw-alias-label-tertiary);font-size:12px;letter-spacing:.01em}

/* The two most recent calls: a quiet list, each row one line. */
.ql-recent{display:flex;flex-direction:column;gap:1px}
.ql-call{display:flex;align-items:center;gap:8px;min-width:0;min-height:20px;
  animation:ql-call-in 260ms cubic-bezier(.23,1,.32,1) both;
  animation-delay:calc(var(--ql-i,0) * 55ms)}
@keyframes ql-call-in{from{opacity:0;transform:translateX(-3px)}to{opacity:1;transform:none}}
/* The bullet rides in the text flow with vertical-align middle, which seats it
   on the lowercase body — the centre the eye reads. Centring it as a flex sibling
   instead put it on the line-box centre, which sits low against Latin names. */
.ql-call-model{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-secondary);font-size:12px}
.ql-call-model::before{content:'';display:inline-block;
  width:4px;height:4px;border-radius:50%;margin-right:7px;
  vertical-align:middle;
  background:var(--dsw-alias-state-business-primary);opacity:.65}
.ql-call-time{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11.5px;
  font-variant-numeric:tabular-nums}
.ql-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ql-btn{
  display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;
  border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:transparent;
  color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;
  transition:background-color 160ms cubic-bezier(.23,1,.32,1),
             transform 160ms cubic-bezier(.23,1,.32,1);
}
.ql-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ql-btn:active:not(:disabled){transform:scale(.97)}
.ql-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ql-btn:disabled{opacity:.45;cursor:default}

.ql-link{color:var(--dsw-alias-label-tertiary);font-size:12px;text-decoration:underline;
  text-underline-offset:2px;border-radius:4px}
.ql-link:hover{color:var(--dsw-alias-label-secondary)}
.ql-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}

.ql-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:0;
  overflow-wrap:anywhere}

/* ── settings ─────────────────────────────────────────────────────────── */
/* A settings page reads best as labelled rows, not as stacked blocks: the label
   is a fixed left column and the control sits right, so the eye can scan one
   column of names. Grouping rows into a bordered card is what every settings
   surface does; it also means the whole page is two cards plus one action row. */
.ql-settings{display:flex;flex-direction:column;gap:16px;padding:4px 0;font-size:13px}

.ql-group-cap{display:block;margin-bottom:6px;
  color:var(--dsw-alias-label-tertiary);font-size:11px;letter-spacing:.04em}
.ql-group-wrap{display:block;min-width:0}
.ql-group{display:flex;flex-direction:column;
  border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 94%, var(--dsw-alias-label-primary) 6%)}
.ql-srow{display:flex;align-items:center;justify-content:space-between;gap:14px;
  min-height:38px;padding:9px 12px;min-width:0}
.ql-srow + .ql-srow{border-top:.5px solid var(--dsw-alias-border-l2)}
/* Settings rows arrive in sequence as the section mounts. This is a page a reader
   opens occasionally, not an element they toggle repeatedly, so the entrance is
   allowed to be noticed. */
.ql-group .ql-srow{animation:ql-srow-in 300ms cubic-bezier(.23,1,.32,1) both;
  animation-delay:calc(var(--ql-i,0) * 45ms + 200ms)}
.ql-srow-k{flex:none;color:var(--dsw-alias-label-secondary);font-size:12.5px;
  white-space:nowrap}

/* The value column stacks under its label when the chips need the whole width.
   A fixed right-aligned column squeezed five chips into two cramped rows. */
.ql-srow.is-stacked{flex-direction:column;align-items:stretch;gap:7px}
.ql-srow-v{flex:1;min-width:0;display:flex;justify-content:flex-end;
  align-items:center;gap:6px;flex-wrap:wrap}
.ql-srow.is-stacked .ql-srow-v{justify-content:flex-start;flex:0 0 auto}

/* The readout at the top of the settings page reuses the panel's window row, so
   the two places look like the same product. Only the entrance differs. */
.ql-wins-grow{gap:16px;padding:11px 12px 10px}
.ql-win.is-grow{gap:5px;animation:ql-srow-in 320ms cubic-bezier(.23,1,.32,1) both;
  animation-delay:calc(var(--ql-i,0) * 70ms)}
@keyframes ql-srow-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

.ql-srow-val{font-size:12px;line-height:1.3;font-variant-numeric:tabular-nums;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ql-srow-note{font-size:12px;line-height:1.3;color:var(--dsw-alias-label-tertiary);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Credential state: a dot plus one short phrase, right-aligned. */
.ql-state{display:inline-flex;align-items:center;gap:6px;max-width:100%;
  color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.4}
.ql-state::before{content:'';width:6px;height:6px;border-radius:50%;flex:none;
  background:var(--dsw-alias-label-tertiary);opacity:.55;
  transition:background-color 200ms cubic-bezier(.23,1,.32,1),opacity 200ms cubic-bezier(.23,1,.32,1)}
.ql-state.is-on{color:var(--dsw-alias-state-business-primary)}
.ql-state.is-on::before{background:currentColor;opacity:.95}
.ql-state-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}

/* The action area is its own stack: the primary action keeps a full row, then the
   manual field gets one, then the footnote. Putting all three on one line is what
   squeezed the input down to a sliver. */
.ql-actions-row{display:flex;flex-direction:column;align-items:stretch;gap:8px;margin-top:10px}
.ql-actions-row .ql-btns{display:flex;gap:8px;flex-wrap:wrap}
.ql-actions-row .ql-field{display:flex;gap:8px;min-width:0}
.ql-actions-row > .ql-btn{flex:none;white-space:nowrap;align-self:flex-start}

/* Footnote and footer each get their own line, with breathing room above. */
.ql-hint{margin-top:9px}
.ql-foot{display:flex;align-items:center;gap:14px;margin-top:6px;padding-top:10px;
  border-top:.5px solid var(--dsw-alias-border-l2)}
.ql-foot .ql-btn.is-quiet{padding:0 10px}

.ql-input{
  flex:1;min-width:0;height:32px;padding:0 10px;box-sizing:border-box;
  border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 90%, var(--dsw-alias-label-primary) 10%);
  color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;
  transition:border-color 160ms cubic-bezier(.23,1,.32,1)
}
.ql-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.ql-input:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
.ql-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

/* A footnote, one line where possible. */
.ql-note{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px;margin:0}
.ql-note.is-good{color:var(--dsw-alias-state-business-primary)}

/* A primary action reads as branded; a quiet one steps back. */
.ql-btn.is-primary{
  border-color:var(--dsw-alias-brand-primary);
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
  color:var(--dsw-alias-label-primary);
}
.ql-btn.is-primary:hover:not(:disabled){
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent);
}
.ql-btn.is-quiet{color:var(--dsw-alias-label-tertiary);border-color:transparent}
.ql-btn.is-quiet:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ql-field .ql-btn{height:32px;padding:0 14px}
.ql-actions-row .ql-btn{height:32px;padding:0 14px}

/* ── reduced motion: one switch, everything off ───────────────────────── */
@media (prefers-reduced-motion:reduce){
  .ql-panel,.ql-panel > *,.ql-win,.ql-call,.ql-srow,.ql-group{animation:none}
  .ql-bar-fill,.ql-bar-fill.is-grow,.ql-ring,.ql-ring-fill,.ql-pill,.ql-btn,.ql-mode,.ql-input{transition:none;animation:none}
  .ql-bar-fill.is-grow{transform:scaleX(var(--ql-pct,1))}
  .ql-pill:active,.ql-btn:active:not(:disabled),.ql-mode:active{transform:none}
}`

    /** Money via Intl, so the grouping matches the reader's locale. */
    const moneyFormat = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    const creditFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

    /** A currency figure, or an em dash when the value is unusable. */
    function money(amount, currency = 'USD') {
      const value = Number(amount)
      if (!Number.isFinite(value)) return '—'
      if (currency === 'USD') return moneyFormat.format(value)
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
      } catch {
        return `${value.toFixed(2)} ${currency}`
      }
    }

    /** A count with grouping. */
    function count(value) {
      const number = Number(value)
      return Number.isFinite(number) ? creditFormat.format(number) : '—'
    }

    // One formatter per style: constructing Intl objects in render is the
    // expensive part, not formatting.
    const dateFormat = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    const clockFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

    /** A short local timestamp, or null when the input is unusable. */
    function when(input, short = false) {
      if (input === null || input === undefined || input === '') return null
      const at = input instanceof Date ? input : new Date(input)
      if (Number.isNaN(at.getTime())) return null
      return (short ? clockFormat : dateFormat).format(at)
    }

    /** Hours until an instant, or null. */
    function hoursUntil(iso) {
      if (typeof iso !== 'string' || iso === '') return null
      const at = new Date(iso).getTime()
      if (!Number.isFinite(at)) return null
      return (at - Date.now()) / 3_600_000
    }

    /**
     * A moment as how long ago it was.
     *
     * A clock time answers "when", but the question behind it is "was that just
     * now, or hours ago" — and that question is answered without arithmetic by
     * relative wording. The exact time stays available in the tooltip.
     * @param {string} iso
     * @returns {string | null}
     */
    function relativeTime(iso) {
      if (typeof iso !== 'string' || iso === '') return null
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return null
      const minutes = (Date.now() - at) / 60_000
      // A record a few seconds in the future means clock skew, not prophecy.
      if (minutes < 1) return '刚刚'
      if (minutes < 60) return `${Math.round(minutes)} 分钟前`
      const hours = minutes / 60
      if (hours < 24) return `${Math.round(hours)} 小时前`
      const days = Math.round(hours / 24)
      return days <= 1 ? '昨天' : `${days} 天前`
    }

    /** One host route call, tolerating a non-JSON body. */
    async function call(path, init) {
      const response = await fetch(path, init)
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      return { ok: response.ok, status: response.status, body }
    }

    /** The session's model directory, when the shell provides one. */
    function directoryFor(directories, sessionId) {
      if (!directories || typeof sessionId !== 'string' || sessionId === '') return null
      try {
        return typeof directories.directoryFor === 'function' ? directories.directoryFor(sessionId) : null
      } catch {
        return null
      }
    }

    /** Subscribe to the session's current model provider. */
    function useProvider(directory) {
      const store = directory && typeof directory === 'object' ? directory.store : null
      const subscribe = React.useCallback(
        (listener) => (store && typeof store.subscribe === 'function' ? store.subscribe(listener) : () => {}),
        [store],
      )
      const read = React.useCallback(
        () => (store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : null),
        [store],
      )
      const snapshot = React.useSyncExternalStore(subscribe, read, read)
      React.useEffect(() => {
        if (directory && typeof directory.load === 'function') Promise.resolve(directory.load()).catch(() => {})
      }, [directory])
      const current = snapshot && typeof snapshot === 'object' ? snapshot.current : null
      const provider = current && typeof current.provider === 'string' ? current.provider.trim().toLowerCase() : null
      return provider !== null && PROVIDERS.includes(provider) ? provider : null
    }

    /** The worst remaining percentage across measured windows, or null. */
    function worstPct(windows) {
      const measured = (Array.isArray(windows) ? windows : []).filter((entry) => typeof entry.remainingPct === 'number')
      if (measured.length === 0) return null
      return measured.reduce((low, entry) => Math.min(low, entry.remainingPct), 100)
    }

    /**
     * A short code for one window's length: `5h`, `7d`.
     *
     * Derived from the duration the vendor reports rather than from its label,
     * because the label set is the backend's to change and the duration is not.
     * @param {object} entry
     * @returns {string}
     */
    function shortCode(entry) {
      const seconds = Number(entry?.durationSeconds)
      if (!Number.isFinite(seconds) || seconds <= 0) return '?'
      const day = 86_400
      const hour = 3_600
      if (seconds % day === 0) return `${seconds / day}d`
      if (seconds % hour === 0) return `${seconds / hour}h`
      return `${Math.round(seconds / hour)}h`
    }

    /**
     * Split windows into the short and long cycle, which is what the pill's
     * display modes name. With more than two windows the extremes win, because
     * those are the two a reader actually compares.
     * @param {object[]} windows
     * @returns {{ short: object | null, long: object | null }}
     */
    function cyclePair(windows) {
      const measured = (Array.isArray(windows) ? windows : [])
        .filter((entry) => typeof entry.remainingPct === 'number')
        .slice()
        .sort((left, right) => (Number(left.durationSeconds) || 0) - (Number(right.durationSeconds) || 0))
      if (measured.length === 0) return { short: null, long: null }
      if (measured.length === 1) return { short: measured[0], long: null }
      return { short: measured[0], long: measured[measured.length - 1] }
    }

    /**
     * Text modes for the pill, in menu order.
     *
     * The two single-cycle modes are named after the cycle they show (`仅 5h`,
     * `仅 7d`) rather than "short"/"long", because that is how the console names
     * them and how a reader thinks about them.
     */
    const PILL_MODES = Object.freeze(['hour', 'day', 'both', 'none'])
    const PILL_MODE_TEXT = Object.freeze({
      both: '两个窗口都显示',
      none: '不显示文字',
    })

    /**
     * The window a single-cycle mode should show.
     *
     * An account can have only one window (a lone 14-day pool, say). Falling back
     * to "7d" there would name a cycle that does not exist, so the one window that
     * does exist answers for either chip — and it is always labelled with its own
     * real length.
     * @param {'hour'|'day'} mode
     * @param {{ short: object | null, long: object | null }} pair
     * @returns {object | null}
     */
    function cycleFor(mode, pair) {
      if (mode === 'day') return pair.long ?? pair.short
      return pair.short ?? pair.long
    }

    /**
     * The label for one mode, using the account's real cycle codes.
     *
     * A hardcoded "7d" would lie on an account whose windows are not 5h/7d, so
     * the code comes from the reading whenever one is available.
     * @param {string} mode
     * @param {object[]} [windows]
     * @returns {string}
     */
    function pillModeLabel(mode, windows) {
      const pair = cyclePair(windows)
      if (mode === 'hour' || mode === 'day') {
        const entry = cycleFor(mode, pair)
        const code = entry === null ? (mode === 'day' ? '7d' : '5h') : shortCode(entry)
        return `仅 ${code} 百分比`
      }
      return PILL_MODE_TEXT[mode] ?? mode
    }

    /** Indicator modes for the pill: the circle in front of the text. */
    const INDICATOR_MODES = Object.freeze(['ring', 'dot', 'none'])
    const INDICATOR_LABEL = Object.freeze({
      ring: '圆环',
      dot: '圆点',
      none: '不显示',
    })

    const PILL_MODE_KEY = 'opendesign-runway.pillMode'
    const INDICATOR_KEY = 'opendesign-runway.indicator'

    /**
     * Carry a stored mode from an older build forward.
     *
     * `worst` showed the tightest window, which is the short cycle in practice;
     * `short`/`long` were renamed to `hour`/`day`. Reading an old value as the
     * nearest new one keeps a user's choice instead of resetting it.
     * @param {string | null} stored
     * @returns {string}
     */
    function migrateMode(stored) {
      if (PILL_MODES.includes(stored)) return stored
      if (stored === 'worst' || stored === 'short') return 'hour'
      if (stored === 'long') return 'day'
      return 'hour'
    }

    /** Read one stored value, tolerating an unavailable or corrupt store. */
    function readStored(key, allowed, fallback) {
      try {
        const stored = window.localStorage.getItem(key)
        return allowed.includes(stored) ? stored : fallback
      } catch {
        return fallback
      }
    }

    /** Read the stored pill mode, carrying an older build's value forward. */
    function readStoredMode() {
      try {
        return migrateMode(window.localStorage.getItem(PILL_MODE_KEY))
      } catch {
        return 'hour'
      }
    }

    /** Persist one value; a storage failure is not worth surfacing. */
    function writeStored(key, value) {
      try {
        window.localStorage.setItem(key, value)
      } catch {}
    }

    /**
     * Display preferences, shared by the pill and the settings page.
     *
     * They live in one observable object rather than in each component's state:
     * the settings page owns the controls, the pill owns the rendering, and both
     * must agree the moment a chip is clicked — a `localStorage` write alone
     * would not re-render the pill until the next poll.
     */
    const prefs = (() => {
      let state = {
        mode: readStoredMode(),
        indicator: readStored(INDICATOR_KEY, INDICATOR_MODES, 'ring'),
      }
      const listeners = new Set()
      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        get() {
          return state
        },
        set(patch) {
          state = { ...state, ...patch }
          if (Object.hasOwn(patch, 'mode')) writeStored(PILL_MODE_KEY, state.mode)
          if (Object.hasOwn(patch, 'indicator')) writeStored(INDICATOR_KEY, state.indicator)
          for (const listener of listeners) listener()
        },
      }
    })()

    /** Subscribe a component to the display preferences. */
    function usePrefs() {
      return React.useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get)
    }

    /**
     * A token count in the compact form people read at a glance.
     *
     * Token totals reach hundreds of millions, and a raw number in a 2-column
     * grid wraps or clips; 205.5M is both exact enough and short.
     */
    function compactTokens(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return '0'
      if (number >= 1e9) return `${(number / 1e9).toFixed(1)}B`
      if (number >= 1e6) return `${(number / 1e6).toFixed(1)}M`
      if (number >= 1e3) return `${(number / 1e3).toFixed(1)}K`
      return String(Math.round(number))
    }

    /**
     * Severity for a remaining percentage.
     *
     * Thresholds are deliberately wide (≤50% is already a warning): a quota that
     * is half gone deserves a colour, not just one that is nearly empty. A bar
     * that stays green until 30% left reads as "no signal" for most of its life.
     */
    function toneClass(pct) {
      if (pct === null) return 'is-ok'
      if (pct <= 20) return 'is-low'
      if (pct <= 50) return 'is-warn'
      return 'is-ok'
    }

    /** What the pill says. Short: the provider name lives in the tooltip. */
    function pillText(snapshot, mode) {
      const reading = snapshot?.reading
      if (!reading) return '…'
      if (reading.status !== 'ok') {
        if (reading.status === 'no-credential') return '未绑定'
        if (reading.status === 'unauthorized') return '登录失效'
        return '读取失败'
      }
      const windows = Array.isArray(reading.windows) ? reading.windows : []
      const pair = cyclePair(windows)
      if (mode === 'none') return ''
      if (mode === 'both') {
        const parts = [pair.short, pair.long]
          .filter((entry) => entry !== null)
          .map((entry) => `${shortCode(entry)} ${Math.round(entry.remainingPct)}%`)
        if (parts.length > 0) return parts.join(' · ')
        // No measured window: fall through so a wallet figure still shows.
      }
      if (mode === 'hour' || mode === 'day') {
        const entry = cycleFor(mode, pair)
        if (entry !== null) return `${shortCode(entry)} ${Math.round(entry.remainingPct)}%`
        // A single-cycle mode with nothing to show says so rather than borrowing
        // a number from another cycle, which would misreport what is displayed.
        if (windows.length > 0) return '—'
      }
      if (typeof reading.money?.amount === 'number') return money(reading.money.amount, reading.money.currency ?? 'USD')
      return '无数据'
    }

    /** A full sentence for the pill's accessible name. */
    function pillAria(snapshot, mode) {      const reading = snapshot?.reading
      if (!reading || reading.status !== 'ok') return `${PROVIDER_LABEL} 额度：${pillText(snapshot, mode)}`
      const text = pillText(snapshot, mode)
      if (text !== '') return `${PROVIDER_LABEL} 额度：${text}`
      const pct = worstPct(reading.windows)
      return pct === null
        ? `${PROVIDER_LABEL} 额度：暂无数据`
        : `${PROVIDER_LABEL} 额度：最紧的窗口剩 ${Math.round(pct)}%`
    }

    /**
     * A circular gauge standing in for the solid status dot.
     *
     * Drawn as two arcs on one SVG: a faint full track and a coloured arc whose
     * dash offset is the remaining share. 14px keeps it the same weight as the
     * dot it replaces while carrying the number at a glance.
     * @param {{ percent: number | null, tone: string }} props
     */
    function Ring({ percent, tone }) {
      const size = 14
      const stroke = 2
      const radius = (size - stroke) / 2
      const circumference = 2 * Math.PI * radius
      const ratio = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100
      const dash = circumference * ratio
      return h('svg', {
        className: `ql-ring ${tone}`,
        width: size,
        height: size,
        viewBox: `0 0 ${size} ${size}`,
        'aria-hidden': 'true',
      }, [
        h('circle', {
          key: 'track',
          className: 'ql-ring-track',
          cx: size / 2,
          cy: size / 2,
          r: radius,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: stroke,
        }),
        h('circle', {
          key: 'fill',
          className: 'ql-ring-fill',
          cx: size / 2,
          cy: size / 2,
          r: radius,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: stroke,
          strokeLinecap: 'round',
          strokeDasharray: `${circumference} ${circumference}`,
          strokeDashoffset: circumference - dash,
          transform: `rotate(-90 ${size / 2} ${size / 2})`,
        }),
      ])
    }

    /** The plain status dot, kept as an alternative to the ring. */
    function Dot({ tone }) {
      return h('span', { className: `ql-dot ${tone}`, 'aria-hidden': 'true' })
    }

    /** The indicator the pill shows in front of its text. */
    function Indicator({ mode, percent, tone }) {
      if (mode === 'none') return null
      if (mode === 'dot') return h(Dot, { tone })
      return h(Ring, { percent, tone })
    }

    /** One labelled row. */
    function Row({ label, value, strong }) {
      return h('div', { className: 'ql-row' }, [
        h('span', { key: 'k', className: 'ql-k' }, label),
        h('span', { key: 'v', className: strong ? 'ql-v is-strong' : 'ql-v' }, value),
      ])
    }

    /**
     * What the window's own burn rate implies, phrased as one line.
     *
     * Answers the question a plan user actually has — will this run out before it
     * resets — using the rate measured from the window's own anchor, so the answer
     * does not depend on how long this page has been open.
     *
     * Only the long cycle gets this line. A 5-hour window resets before any
     * meaningful trend forms, so a prediction there would be noise dressed as
     * insight: the short window's job is to show its percentage and move on.
     * @param {object} entry a window from the reading
     * @returns {{ text: string, tone: 'ok' | 'warn' } | null}
     */
    function outlookLine(entry) {
      const seconds = Number(entry?.durationSeconds)
      // Under a day: no forecast. The number would be recalculated from a
      // handful of minutes of history and read as more certain than it is.
      if (!Number.isFinite(seconds) || seconds < 86_400) return null

      const hours = seconds / 3_600
      const credits = entry?.credits ?? {}
      const used = Number(credits.used)
      const remaining = Number(credits.remaining)
      const resetMs = Date.parse(entry?.resetAt ?? '')
      const startMs = Date.parse(entry?.windowStart ?? '')
      if (!Number.isFinite(used) || !Number.isFinite(remaining) || !Number.isFinite(resetMs)) return null

      const now = Date.now()
      const hoursToReset = (resetMs - now) / 3_600_000
      if (!Number.isFinite(hoursToReset) || hoursToReset <= 0) return null

      const anchorMs = Number.isFinite(startMs) ? startMs : resetMs - hours * 3_600_000
      const elapsedHours = (now - anchorMs) / 3_600_000
      if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) return null

      if (used === 0) return { text: '还没开始消耗', tone: 'ok' }
      const perHour = used / elapsedHours
      if (!Number.isFinite(perHour) || perHour <= 0) return null
      const hoursToExhaust = remaining / perHour

      const compact = (value) => (value < 1 ? '不到 1 小时' : `约 ${Math.round(value)} 小时`)
      if (hoursToExhaust < hoursToReset) {
        return { text: `照此速度 ${compact(hoursToExhaust)}后耗尽`, tone: 'warn' }
      }
      return { text: '照此速度能撑到重置', tone: 'ok' }
    }

    /**
     * One plan window, in three tight rows:
     *
     *   Design Plan · 7 天                    75%
     *   ▓▓▓▓▓▓▓▓▓▓▓▓▓▒░░
     *   112500 / 150000 · 6 天后重置
     *   照此速度能撑到重置
     *
     * Credits and the reset moment share one line because they are both
     * supporting detail; giving each its own row doubled the panel's height for
     * numbers that belong together.
     */
    function WindowRow({ entry, index, grow = false }) {
      const pct = typeof entry.remainingPct === 'number' ? entry.remainingPct : null
      const remainingHours = hoursUntil(entry.resetAt)
      // "3 小时后重置" answers when, but not what the reader actually wants to
      // know: whether waiting is worth it. The clock time goes in the tooltip.
      const resetText = remainingHours === null || remainingHours < 0
        ? null
        : remainingHours < 1 / 60
          ? '即将重置'
          : remainingHours < 1
            // Under an hour, "less than 1 hour" is not something anyone can act
            // on; the minute count is.
            ? `${Math.max(1, Math.round(remainingHours * 60))} 分钟后重置`
            : remainingHours < 24
              ? `${Math.round(remainingHours)} 小时后重置`
              : `${Math.round(remainingHours / 24)} 天后重置`
      const credits = entry.credits ?? {}
      const creditText = credits.remaining !== null && credits.remaining !== undefined
        ? `${count(credits.remaining)} / ${count(credits.limit)}`
        : null
      const meta = [creditText, resetText].filter((part) => part !== null).join(' · ')
      const outlook = outlookLine(entry)
      const resetTitle = remainingHours !== null && remainingHours >= 0
        ? `重置于 ${when(entry.resetAt) ?? ''}`
        : ''
      const ratio = pct === null ? 0 : Math.max(0, Math.min(100, pct)) / 100

      return h('div', {
        className: grow ? 'ql-win is-grow' : 'ql-win',
        style: { '--ql-i': index },
      }, [
        h('div', { key: 'head', className: 'ql-win-head' }, [
          h('span', { key: 'n', className: 'ql-win-name', title: entry.label }, entry.label),
          h('span', { key: 'p', className: 'ql-win-pct' }, pct === null ? '不可读' : `${Math.round(pct)}%`),
        ]),
        pct === null
          ? null
          : h('div', {
            key: 'bar',
            className: 'ql-bar',
            role: 'progressbar',
            'aria-label': `${entry.label} 剩余`,
            'aria-valuenow': Math.round(pct),
            'aria-valuemin': 0,
            'aria-valuemax': 100,
          }, h('div', {
            // On the settings page the bar draws itself on arrival; the panel
            // keeps the plain fill, because a pill opened and closed repeatedly
            // must not replay an entrance.
            className: grow
              ? `ql-bar-fill is-grow ${toneClass(pct)}`
              : `ql-bar-fill ${toneClass(pct)}`,
            style: grow
              ? { '--ql-pct': ratio }
              : { transform: `scaleX(${ratio})` },
          })),
        meta === '' ? null : h('span', { key: 'm', className: 'ql-win-meta', title: resetTitle }, meta),
        outlook === null
          ? null
          : h('span', {
            key: 'o',
            className: outlook.tone === 'warn' ? 'ql-outlook is-warn' : 'ql-outlook',
          }, outlook.text),
      ])
    }

    /**
     * The last snapshot this browser saw, kept across restarts.
     *
     * A restart is followed by a cold read: credentials, then two upstream calls,
     * which is a second or two of an empty pill. Showing the previous numbers
     * immediately — marked as stale — is better than showing nothing, as long as
     * the age is visible and a real read is already on its way.
     */
    const SNAPSHOT_CACHE_KEY = 'opendesign-runway.lastSnapshot'
    const CACHE_MAX_AGE_MS = 30 * 60 * 1000

    /** Read the cached snapshot for one provider, or null when unusable. */
    function readCachedSnapshot() {
      try {
        const raw = window.localStorage.getItem(SNAPSHOT_CACHE_KEY)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return null
        if (parsed.provider !== 'opendesign') return null
        if (typeof parsed.at !== 'number' || Date.now() - parsed.at > CACHE_MAX_AGE_MS) return null
        if (parsed.body === null || typeof parsed.body !== 'object') return null
        return parsed
      } catch {
        return null
      }
    }

    /** Persist the last good snapshot; a storage failure is not worth surfacing. */
    function writeCachedSnapshot(body) {
      try {
        window.localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify({
          provider: 'opendesign',
          at: Date.now(),
          body,
        }))
      } catch {}
    }

    /** The pill and its detail panel. */
    function Pill(props) {
      const provider = useProvider(directoryFor(props.directories, props.sessionId))
      const cached = React.useMemo(readCachedSnapshot, [])
      const [snapshot, setSnapshot] = React.useState(cached === null ? null : cached.body)
      const [stale, setStale] = React.useState(cached !== null)
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const { mode, indicator } = usePrefs()
      const anchor = React.useRef(null)

      const load = React.useCallback(async (refresh) => {
        if (provider === null) return
        try {
          const result = await call(`${PATHS.snapshot}${refresh ? '?refresh=1' : ''}`)
          if (result.body) {
            setSnapshot(result.body)
            setStale(false)
            setError(null)
            // Only a real reading is worth caching; a failure keeps the old one.
            if (result.body.reading?.status === 'ok') writeCachedSnapshot(result.body)
          } else setError(`快照不可用（HTTP ${result.status}）`)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }, [provider])

      React.useEffect(() => {
        if (provider === null) return undefined
        void load(false)
        const timer = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') void load(false)
        }, POLL_MS)
        return () => clearInterval(timer)
      }, [provider, load])

      React.useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        const onDown = (event) => {
          if (anchor.current !== null && !anchor.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onDown)
        return () => {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onDown)
        }
      }, [open])

      async function refreshNow() {
        if (busy) return
        setBusy(true)
        await load(true)
        setBusy(false)
      }

      // Hooks always run; only the output is gated, so a provider switch cannot
      // change hook order.
      if (provider === null) return null

      const reading = snapshot?.reading ?? null
      const windows = Array.isArray(reading?.windows) ? reading.windows : []
      const usage = reading?.usage ?? null
      const billing = reading?.billing ?? null
      const amount = reading?.money?.amount
      const text = pillText(snapshot, mode)
      // The ring mirrors the text: it shows the cycle the pill names, so a
      // "仅 7d" pill never draws a 5-hour arc.
      const pair = cyclePair(windows)
      const ringSource = mode === 'hour' || mode === 'day' ? cycleFor(mode, pair) : null
      const pct = ringSource !== null ? ringSource.remainingPct : worstPct(windows)
      // Both controls off means the pill would be an empty box with no text, no
      // indicator, and no reason to click. Nothing is rendered at all.
      if (indicator === 'none' && text === '') return null

      return h('div', { className: 'ql-root', ref: anchor }, [
        h('button', {
          key: 'pill',
          type: 'button',
          className: 'ql-pill',
          title: snapshot?.sourceLine ?? `${PROVIDER_LABEL} 额度`,
          'aria-label': pillAria(snapshot, mode),
          'aria-expanded': open ? 'true' : 'false',
          'aria-haspopup': 'dialog',
          onClick: () => setOpen((next) => !next),
        }, [
          h(Indicator, { key: 'indicator', mode: indicator, percent: pct, tone: toneClass(pct) }),
          text === '' ? null : h('span', { key: 'text', className: 'ql-label' }, text),
          // A stale reading keeps its numbers but says so, so a restart never
          // reads as "these are the current figures".
          stale ? h('span', { key: 'stale', className: 'ql-stale', title: '正在刷新' }, '旧') : null,
        ]),

        open ? h('div', {
          key: 'panel',
          className: 'ql-panel',
          role: 'dialog',
          'aria-label': `${PROVIDER_LABEL} 额度详情`,
        }, [
          h('div', { key: 'head', className: 'ql-head' }, [
            h('span', { key: 't', className: 'ql-title' }, `${PROVIDER_LABEL} 额度`),
            stale
              ? h('span', { key: 'stale', className: 'ql-stale', 'aria-live': 'polite' }, '旧数据 · 正在刷新')
              : null,
            h('a', {
              key: 'a',
              className: 'ql-link',
              href: DASHBOARD,
              target: '_blank',
              rel: 'noreferrer',
            }, '控制台'),
          ]),

          windows.length > 0
            ? h('div', { key: 'wins', className: 'ql-wins' },
              windows.map((entry, index) => h(WindowRow, { key: entry.key, entry, index })))
            : h('span', { key: 'nowins', className: 'ql-sub' },
              reading?.message ?? '这个账号当前没有套餐窗口。'),

          // Account facts under the windows: the plan, then the money behind it.
          // Both are single key/value rows so the labels line up in one column,
          // and a hairline separates them from the window gauges above.
          reading?.tier != null || typeof amount === 'number'
            ? h('div', { key: 'meta', className: 'ql-meta' }, [
              reading?.tier
                ? h(Row, { key: 'tier', label: '套餐', value: String(reading.tier).toUpperCase() })
                : null,
              typeof amount === 'number'
                ? h(Row, { key: 'wallet', label: '钱包余额', value: money(amount, reading.money.currency ?? 'USD') })
                : null,
            ])
            : null,

          // Delivery note: the usage block is deliberately terse. A truncated
          // page count is a limitation of the read, not a fact about the account,
          // so it is never surfaced as a row — the figure simply is what it is.
          usage !== null && usage.today !== undefined ? h('div', { key: 'tail', className: 'ql-tail' }, [
            h('div', { key: 'sep', className: 'ql-sep' }),
            h('div', { key: 'tok', className: 'ql-tokrow' }, [
              h('span', { key: 'k', className: 'ql-tok-k' }, '今日 token'),
              h('span', { key: 'v', className: 'ql-tok-v' }, compactTokens(usage.today.input + usage.today.output)),
            ]),
            Array.isArray(usage.recent) && usage.recent.length > 0
              ? h('div', { key: 'calls', className: 'ql-calls' }, [
                h('span', { key: 'cap', className: 'ql-calls-cap' }, '最近两次调用'),
                h('div', { key: 'recent', className: 'ql-recent' },
                  usage.recent.map((row, index) => h('div', {
                    key: `${row.at}-${index}`,
                    className: 'ql-call',
                    style: { '--ql-i': index },
                  }, [
                    h('span', { key: 'm', className: 'ql-call-model', title: row.model }, row.model),
                    h('span', {
                      key: 't',
                      className: 'ql-call-time',
                      title: when(row.at) ?? '',
                    }, relativeTime(row.at) ?? '—'),
                  ]))),
              ])
              : null,
          ]) : null,

          reading?.usageError ? h('p', { key: 'uerr', className: 'ql-err' }, reading.usageError) : null,

          billing !== null && (billing.periodEnd !== null || billing.status !== null)
            ? h('div', { key: 'billing', className: 'ql-tail' }, [
              h('div', { key: 'sep', className: 'ql-sep' }),
              billing.status !== null
                ? h(Row, { key: 'st', label: '订阅', value: billing.cancelAtPeriodEnd ? `${billing.status} · 到期取消` : billing.status })
                : null,
              billing.periodEnd !== null
                ? h(Row, { key: 'end', label: '周期结束', value: when(billing.periodEnd) ?? billing.periodEnd })
                : null,
            ]) : null,

          error !== null ? h('p', { key: 'err', className: 'ql-err' }, error) : null,

          h('div', { key: 'act', className: 'ql-actions' }, [
            h('button', {
              key: 'r',
              type: 'button',
              className: 'ql-btn',
              disabled: busy,
              onClick: () => { void refreshNow() },
            }, busy ? '刷新中…' : '刷新'),
            h('span', {
              key: 'as',
              className: 'ql-sub',
              'aria-live': 'polite',
            }, busy
              ? '正在读取…'
              : snapshot?.asOf ? `更新于 ${when(new Date(snapshot.asOf), true) ?? '—'}` : ''),
          ]),
        ]) : null,
      ])
    }

    /** The settings section: live readout, display choices, credentials. */
    function SettingsSection() {
      const { mode, indicator } = usePrefs()
      const [snapshot, setSnapshot] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)

      const refresh = React.useCallback(async () => {
        try {
          const result = await call(PATHS.snapshot)
          if (result.body) setSnapshot(result.body)
        } catch {
          setSnapshot(null)
        }
      }, [])

      // Fast polling exists to notice a sign-in completing in another window. The
      // reading does not need that cadence, so the cycle stays slow and speeds up
      // only while a login is actually in flight.
      const pending = snapshot?.login?.state === 'starting' || snapshot?.login?.state === 'pending'
      React.useEffect(() => {
        void refresh()
        const timer = setInterval(
          () => { void refresh() },
          pending ? LOGIN_POLL_MS : POLL_MS,
        )
        return () => clearInterval(timer)
      }, [refresh, pending])

      async function signIn() {
        setBusy(true)
        setMessage(null)
        try {
          const result = await call(PATHS.login, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          if (result.body?.availability?.available === false) {
            setMessage({ kind: 'bad', text: result.body.availability.reason })
          } else {
            setMessage({ kind: 'ok', text: '登录窗口已打开，请在里面完成登录。' })
          }
          void refresh()
        } catch {
          setMessage({ kind: 'bad', text: '宿主路由不可达。' })
        } finally {
          setBusy(false)
        }
      }

      async function cancel() {
        try {
          await call(PATHS.login, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cancel: true }) })
        } catch {}
        void refresh()
      }

      async function bind() {
        const value = draft.trim()
        if (value === '') return
        setBusy(true)
        setMessage(null)
        try {
          const result = await call(PATHS.credential, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ cookie: value }),
          })
          if (result.body?.ok) {
            setDraft('')
            setMessage({ kind: 'ok', text: '已保存并通过验证。' })
            void refresh()
          } else {
            setMessage({ kind: 'bad', text: result.body?.message ?? `HTTP ${result.status}` })
          }
        } catch {
          setMessage({ kind: 'bad', text: '宿主路由不可达。' })
        } finally {
          setBusy(false)
        }
      }

      async function forget() {
        setBusy(true)
        setMessage(null)
        try {
          await call(PATHS.logout, { method: 'POST' })
          setMessage({ kind: 'ok', text: '已清除本机凭据。' })
          void refresh()
        } catch {
          setMessage({ kind: 'bad', text: '宿主路由不可达。' })
        } finally {
          setBusy(false)
        }
      }

      const login = snapshot?.login ?? { state: 'idle' }
      const session = snapshot?.session ?? { set: false, tail: '' }
      const controlKey = snapshot?.controlKey ?? { set: false, tail: '', path: '', reason: null }
      const running = login.state === 'starting' || login.state === 'pending'
      // Window labels come from the live reading, so the chips name the account's
      // real cycles instead of assuming 5h/7d.
      const windows = Array.isArray(snapshot?.reading?.windows) ? snapshot.reading.windows : []

      // The readout at the top: someone who hid the pill entirely still opens this
      // page, and owes themselves the numbers rather than only the switches.
      const reading = snapshot?.reading ?? null
      const healthy = reading?.status === 'ok'
      const walletAmount = healthy && typeof reading?.money?.amount === 'number' ? reading.money.amount : null
      const usage = healthy ? (reading?.usage ?? null) : null
      const tokensToday = usage !== null && usage.today !== undefined
        ? (usage.today.input ?? 0) + (usage.today.output ?? 0)
        : null
      // The reading's own timestamp, not the snapshot's: a cached reading keeps
      // its original time, and `asOf` is when the page asked — which would always
      // read "just now" even for numbers an hour old.
      const readAtIso = typeof reading?.queriedAt === 'number'
        ? new Date(reading.queriedAt).toISOString()
        : (typeof snapshot?.asOf === 'number' ? new Date(snapshot.asOf).toISOString() : null)
      const readAt = readAtIso === null ? null : relativeTime(readAtIso)

      return h('div', { className: 'ql-settings' }, [
        // Numbers first: a page whose only content is switches tells a reader
        // nothing about their account.
        h('section', { key: 'now', className: 'ql-group-wrap' }, [
          h('span', { key: 'cap', className: 'ql-group-cap' }, '当前'),
          healthy
            ? h('div', { key: 'g', className: 'ql-group' }, [
              windows.length > 0
                ? h('div', { key: 'wins', className: 'ql-wins ql-wins-grow' },
                  windows.map((entry, index) => h(WindowRow, { key: entry.key, entry, index, grow: true })))
                : null,
              h('div', { key: 'tier', className: 'ql-srow', style: { '--ql-i': 2 } }, [
                h('span', { key: 'k', className: 'ql-srow-k' }, '套餐'),
                h('div', { key: 'v', className: 'ql-srow-v' },
                  h('span', { key: 't', className: 'ql-srow-val' }, String(reading.tier ?? '—').toUpperCase())),
              ]),
              walletAmount === null ? null : h('div', { key: 'wallet', className: 'ql-srow', style: { '--ql-i': 3 } }, [
                h('span', { key: 'k', className: 'ql-srow-k' }, '钱包余额'),
                h('div', { key: 'v', className: 'ql-srow-v' },
                  h('span', { key: 't', className: 'ql-srow-val' }, money(walletAmount, reading.money.currency ?? 'USD'))),
              ]),
              tokensToday === null ? null : h('div', { key: 'tok', className: 'ql-srow', style: { '--ql-i': 4 } }, [
                h('span', { key: 'k', className: 'ql-srow-k' }, '今日 token'),
                h('div', { key: 'v', className: 'ql-srow-v' },
                  h('span', { key: 't', className: 'ql-srow-val' }, compactTokens(tokensToday))),
              ]),
              readAt === null ? null : h('div', { key: 'at', className: 'ql-srow', style: { '--ql-i': 5 } }, [
                h('span', { key: 'k', className: 'ql-srow-k' }, '更新于'),
                h('div', { key: 'v', className: 'ql-srow-v' },
                  h('span', { key: 't', className: 'ql-srow-note' }, readAt)),
              ]),
            ])
            : h('div', { key: 'g', className: 'ql-group' }, h('div', { className: 'ql-srow' }, [
              h('span', { key: 'k', className: 'ql-srow-k' }, '读数'),
              h('div', { key: 'v', className: 'ql-srow-v' },
                h('span', { key: 't', className: 'ql-srow-note' },
                  reading === null ? '读取中…' : (reading.message ?? '暂时读不到额度。'))),
            ])),
        ]),

        // Display: the two choices this page exists for.
        h('section', { key: 'display', className: 'ql-group-wrap' }, [
          h('span', { key: 'cap', className: 'ql-group-cap' }, '显示'),
          h('div', { key: 'g', className: 'ql-group' }, [
            h('div', { key: 'mode', className: 'ql-srow is-stacked' }, [
              h('span', { key: 'k', className: 'ql-srow-k' }, '胶囊文字'),
              h('div', { key: 'v', className: 'ql-srow-v' },
                h('div', { key: 'g', className: 'ql-modes', role: 'radiogroup', 'aria-label': '胶囊文字' },
                  PILL_MODES.map((option) => h('button', {
                    key: option,
                    type: 'button',
                    role: 'radio',
                    'aria-checked': mode === option ? 'true' : 'false',
                    className: mode === option ? 'ql-mode is-on' : 'ql-mode',
                    onClick: () => prefs.set({ mode: option }),
                  }, pillModeLabel(option, windows))))),
            ]),
            h('div', { key: 'ind', className: 'ql-srow is-stacked' }, [
              h('span', { key: 'k', className: 'ql-srow-k' }, '状态指示'),
              h('div', { key: 'v', className: 'ql-srow-v' },
                h('div', { key: 'g', className: 'ql-modes', role: 'radiogroup', 'aria-label': '状态指示' },
                  INDICATOR_MODES.map((option) => h('button', {
                    key: option,
                    type: 'button',
                    role: 'radio',
                    'aria-checked': indicator === option ? 'true' : 'false',
                    className: indicator === option ? 'ql-mode is-on' : 'ql-mode',
                    onClick: () => prefs.set({ indicator: option }),
                  }, INDICATOR_LABEL[option])))),
            ]),
          ]),
        ]),

        // Credentials: state on the right, actions below.
        h('section', { key: 'cred', className: 'ql-group-wrap' }, [
          h('span', { key: 'cap', className: 'ql-group-cap' }, '凭据'),
          h('div', { key: 'g', className: 'ql-group' }, [
            h('div', { key: 'sess', className: 'ql-srow', style: { '--ql-i': 0 } }, [
              h('span', { key: 'k', className: 'ql-srow-k' }, '浏览器会话'),
              h('div', { key: 'v', className: 'ql-srow-v' },
                h('span', { className: session.set ? 'ql-state is-on' : 'ql-state' }, [
                  h('span', { key: 't', className: 'ql-state-text' },
                    session.set ? `已保存 · ${session.tail}` : '未保存'),
                ])),
            ]),
            h('div', { key: 'ck', className: 'ql-srow', style: { '--ql-i': 1 } }, [
              h('span', { key: 'k', className: 'ql-srow-k' }, 'controlKey'),
              h('div', { key: 'v', className: 'ql-srow-v' },
                h('span', {
                  className: controlKey.set ? 'ql-state is-on' : 'ql-state',
                  title: controlKey.path,
                }, [
                  h('span', { key: 't', className: 'ql-state-text' },
                    controlKey.set ? `已找到 · ${controlKey.tail}` : (controlKey.reason ?? '未找到')),
                ])),
            ]),
          ]),

          login.message ? h('p', { key: 'lm', className: 'ql-note', 'aria-live': 'polite' }, login.message) : null,

          h('div', { key: 'actions', className: 'ql-actions-row' }, [
            h('div', { key: 'btns', className: 'ql-btns' }, [
              h('button', {
                key: 'in',
                type: 'button',
                className: 'ql-btn is-primary',
                disabled: busy || running,
                onClick: signIn,
              }, running ? '登录中…' : '登录 OpenDesign…'),
              running ? h('button', {
                key: 'c',
                type: 'button',
                className: 'ql-btn',
                onClick: cancel,
              }, '取消') : null,
            ]),
            h('div', { key: 'manual', className: 'ql-field' }, [
              h('input', {
                key: 'f',
                className: 'ql-input',
                type: 'password',
                name: 'opendesign-cookie',
                value: draft,
                placeholder: '粘贴 Cookie…',
                autoComplete: 'off',
                spellCheck: false,
                'aria-label': 'OpenDesign Cookie',
                onChange: (event) => setDraft(event.target.value),
              }),
              h('button', {
                key: 'b',
                type: 'button',
                className: 'ql-btn',
                disabled: busy || draft.trim() === '',
                onClick: bind,
              }, '保存'),
            ]),
          ]),

          h('p', { key: 'hint', className: 'ql-note ql-hint' },
            '登录页有 Turnstile，无法自动提交。用上面的按钮在临时窗口登录，或从浏览器复制整条 Cookie 头粘贴。'
            + ' 浏览器会话能读套餐窗口，controlKey 只能读钱包余额。'),
        ]),

        h('div', { key: 'foot', className: 'ql-foot' }, [
          h('a', { key: 'a', className: 'ql-link', href: DASHBOARD, target: '_blank', rel: 'noreferrer' }, '打开控制台'),
          session.set ? h('button', { key: 'x', type: 'button', className: 'ql-btn is-quiet', disabled: busy, onClick: forget }, '清除凭据') : null,
        ]),

        message ? h('p', {
          key: 'msg',
          className: message.kind === 'ok' ? 'ql-note is-good' : 'ql-err',
          'aria-live': 'polite',
        }, message.text) : null,
      ])
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        let modelDirectories = null
        ctx.inject(['modelDirectories'], (scope) => {
          modelDirectories = scope.modelDirectories
        })
        const directoryAccess = {
          directoryFor: (sessionId) => (modelDirectories === null ? null : directoryFor(modelDirectories, sessionId)),
        }

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', 'opendesign-runway')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'opendesign-runway: styles')

        ctx.effect(() => {
          try {
            return ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
              name: 'conversation.input.right',
              id: 'opendesign-runway-pill',
              order: 42,
              inject: (sessionId) => ({ sessionId, directories: directoryAccess }),
            }, Pill))
          } catch (cause) {
            console.error('opendesign-runway: could not register the pill', cause)
            return () => {}
          }
        }, 'opendesign-runway: pill')

        ctx.effect(() => {
          try {
            return ctx.slots.inject('settings.section', () => ctx.slots.register({
              name: 'settings.section',
              id: 'opendesign-runway',
              order: 31,
              label: () => 'OpenDesign',
            }, SettingsSection))
          } catch (cause) {
            console.error('opendesign-runway: could not register the settings section', cause)
            return () => {}
          }
        }, 'opendesign-runway: settings section')
      },
    }
  },
})
