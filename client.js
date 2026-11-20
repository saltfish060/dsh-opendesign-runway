/**
 * dsh-opendesign-runway — browser half.
 *
 * Two surfaces:
 *   - `conversation.input.right` — a compact pill that opens a detail panel.
 *     It appears only while the session's model belongs to OpenDesign.
 *   - `settings.section` — quota overview, display preferences, account connection.
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

    const DEFAULT_REFRESH_SECONDS = 60
    const REFRESH_OPTIONS = ['60', '120', '300', '600']
    const CALLS_PER_PAGE = 5
    const RECENT_CALLS_LIMIT = 20
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
.ql-heading{display:flex;align-items:center;gap:6px;min-width:0}
.ql-title{font-size:13px;font-weight:600;line-height:16px;letter-spacing:-.005em;white-space:nowrap}
.ql-heading .ql-stale{flex:0 1 auto;min-width:0;line-height:16px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ql-head .ql-link{flex:none;white-space:nowrap}
.ql-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;
  overflow-wrap:anywhere}
.ql-sub.is-truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── account summary ──────────────────────────────────────────────────── */
.ql-account{display:flex;align-items:center;gap:7px;min-width:0;
  white-space:nowrap;font-size:11.5px;line-height:16px}
.ql-panel .ql-account{margin-top:-3px}
.ql-plan-tier{padding:0 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;
  background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:650;letter-spacing:.02em}
.ql-plan-period{min-width:0;overflow:hidden;text-overflow:ellipsis;
  color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.ql-plan-period.is-cancelling{color:var(--dsw-alias-state-warn-label)}
.ql-account-wallet{display:flex;align-items:center;gap:5px;margin-left:auto;min-width:0}
.ql-account-wallet-label{color:var(--dsw-alias-label-secondary)}
.ql-account-wallet-amount{font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis}

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
.ql-win-meta{display:flex;align-items:baseline;gap:8px;min-width:0;
  color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;
  font-variant-numeric:tabular-nums;letter-spacing:.01em;white-space:nowrap}
.ql-win-credits{min-width:0;overflow:hidden;text-overflow:ellipsis}
.ql-win-reset{flex:none;margin-left:auto}

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

/* Settings bars draw once without blocking the numbers or actions. */
@keyframes ql-grow-in{from{transform:scaleX(0)}}
.ql-bar-fill.is-grow{
  transform:scaleX(var(--ql-pct,1));
  animation:ql-grow-in 340ms cubic-bezier(.22,1,.36,1) backwards;
}

/* ── misc ─────────────────────────────────────────────────────────────── */
.ql-sep{height:.5px;background:var(--dsw-alias-border-l2);margin:3px 0}

/* Keep the daily total and latest call in one compact column. */
.ql-tail{display:flex;flex-direction:column;gap:7px}

.ql-tokrow{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.ql-tok-k{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1}
.ql-tok-v{font-size:16px;font-weight:650;line-height:1;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}

.ql-call{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:baseline;
  gap:7px;min-width:0;padding:4px 7px;border-radius:6px;
  background:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent);
  animation:ql-call-in 260ms cubic-bezier(.23,1,.32,1) both}
@keyframes ql-call-in{from{opacity:0;transform:translateX(-3px)}to{opacity:1;transform:none}}
.ql-call-label{color:var(--dsw-alias-label-secondary);font-size:11.5px;white-space:nowrap}
.ql-call-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-primary);font-size:12px;font-weight:550}
.ql-call-time{color:var(--dsw-alias-label-secondary);font-size:11.5px;
  font-variant-numeric:tabular-nums;white-space:nowrap}

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
.ql-settings{
  --ql-surface:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 96%, var(--dsw-alias-label-primary) 4%);
  --ql-inset:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 98%, var(--dsw-alias-label-primary) 2%);
  --ql-border:var(--dsw-alias-border-l2);
  --ql-text:var(--dsw-alias-label-primary);
  --ql-muted:var(--dsw-alias-label-secondary);
  --ql-accent:var(--dsw-alias-brand-primary);
  display:grid;gap:12px;container-type:inline-size;padding:2px 0 8px;
  color:var(--ql-text);font-size:13px;line-height:1.5;
  animation:ql-settings-in 180ms cubic-bezier(.23,1,.32,1) both;
}
@keyframes ql-settings-in{from{opacity:0;transform:translateY(3px)}}
.ql-settings-card{min-width:0;padding:14px;display:grid;gap:12px;
  border:1px solid var(--ql-border);border-radius:12px;background:var(--ql-surface)}
.ql-settings-head{display:flex;align-items:center;justify-content:space-between;gap:8px 12px;flex-wrap:wrap}
.ql-settings-title{margin:0;font-size:14px;font-weight:650;line-height:1.4}
.ql-settings-meta{display:flex;align-items:center;justify-content:flex-end;gap:6px 10px;flex-wrap:wrap}
.ql-settings-caption,.ql-settings-note{margin:0;color:var(--ql-muted);font-size:12px;overflow-wrap:anywhere}
.ql-settings-issue{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}
.ql-settings-good{color:var(--dsw-alias-state-business-primary)}
.ql-settings .ql-btn{height:auto;min-height:32px;padding:4px 11px;line-height:1.45}
.ql-settings .ql-btn.is-primary{
  border-color:var(--ql-accent);background:color-mix(in srgb, var(--ql-accent) 15%, transparent)
}
.ql-settings .ql-btn.is-primary:hover:not(:disabled){background:color-mix(in srgb, var(--ql-accent) 25%, transparent)}
.ql-settings .ql-btn.is-quiet{border-color:transparent;color:var(--ql-muted)}
.ql-settings-refresh{min-width:6em}
.ql-refresh-preference{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 12px}
.ql-refresh-preference select{min-height:30px;padding:3px 7px;border:1px solid var(--ql-border);border-radius:7px;
  background:var(--ql-inset);color:var(--ql-text);font:inherit;font-size:12px}
.ql-refresh-preference select:focus-visible{outline:2px solid var(--ql-accent);outline-offset:2px}
.ql-history{display:grid;gap:0;margin:0;padding:0;list-style:none}
.ql-history-columns,.ql-history li{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr) 6.6em;align-items:baseline;gap:6px 8px;min-width:0;font-size:12px}
.ql-history-columns{color:var(--ql-muted);margin-bottom:-8px}
.ql-history li{padding:4px 0}
.ql-history li + li{border-top:1px solid var(--ql-border)}
.ql-history-model,.ql-history-initiator{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ql-history-initiator,.ql-history time{color:var(--ql-muted)}
.ql-history-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.ql-history time,.ql-history-columns span:last-child{text-align:right;font-variant-numeric:tabular-nums}
.ql-history-nav{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap}
.ql-history-nav .ql-btn{min-height:28px;padding:3px 8px}
.ql-history-page{min-width:3em;text-align:center;font-variant-numeric:tabular-nums}
.ql-settings-windows{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.ql-settings .ql-win.is-grow{display:flex;gap:6px;padding:10px 12px;min-width:0;
  border:1px solid var(--ql-border);border-radius:9px;background:var(--ql-inset);animation:none}
.ql-settings .ql-win-pct{font-size:17px}
.ql-settings .ql-win-meta,.ql-settings .ql-outlook:not(.is-warn){color:var(--ql-muted)}
.ql-settings .ql-account{padding:6px 8px;border:1px solid var(--ql-border);
  border-radius:7px;background:var(--ql-inset)}

.ql-preview{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 12px;
  min-height:44px;padding:5px 10px;box-sizing:border-box;
  border:1px dashed var(--ql-border);border-radius:8px;background:var(--ql-inset)}
.ql-preview-value{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:26px;
  padding:2px 9px;border:1px solid var(--ql-border);border-radius:999px;box-sizing:border-box}
.ql-preview-value .ql-label{white-space:normal;overflow-wrap:anywhere;font-size:12px}
.ql-preview-value .ql-label,.ql-preview-value .ql-ring,.ql-preview-value .ql-dot{animation:ql-preview-in 150ms ease-out both}
@keyframes ql-preview-in{from{opacity:.35;transform:translateY(2px)}}
.ql-setting-choice{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 12px;min-width:0}
.ql-setting-choice-title{flex:0 0 5em;color:var(--ql-muted);font-size:12px}
.ql-options{display:flex;flex:1 1 240px;flex-wrap:wrap;gap:5px 6px;min-width:0}
.ql-option{position:relative;min-width:0;cursor:pointer}
.ql-option input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.ql-option span{display:block;box-sizing:border-box;min-height:29px;padding:4px 9px;
  border:1px solid var(--ql-border);border-radius:7px;color:var(--ql-muted);font-size:12px;
  overflow-wrap:anywhere;
  transition:background-color 140ms ease-out,border-color 140ms ease-out,color 140ms ease-out}
.ql-option:hover span{background:var(--dsw-alias-interactive-bg-hover)}
.ql-option input:checked + span{border-color:var(--ql-accent);color:var(--ql-text);
  background:color-mix(in srgb, var(--ql-accent) 16%, transparent)}
.ql-option input:focus-visible + span{outline:2px solid var(--ql-accent);outline-offset:2px}

.ql-connection-state{display:flex;align-items:center;gap:6px;color:var(--ql-muted);font-size:12px}
.ql-connection-state::before{content:'';flex:none;width:6px;height:6px;border-radius:50%;background:currentColor}
.ql-connection-state.is-on{color:var(--dsw-alias-state-business-primary)}
.ql-connection-actions,.ql-cookie-fields,.ql-connection-links{display:flex;align-items:center;flex-wrap:wrap;gap:7px 10px}
.ql-settings-feedback:empty{display:none}
.ql-settings-details{border-top:1px solid var(--ql-border);padding-top:8px;min-width:0}
.ql-settings-details summary{width:fit-content;max-width:100%;padding:2px;color:var(--ql-muted);cursor:pointer}
.ql-settings-details summary:focus-visible{outline:2px solid var(--ql-accent);outline-offset:2px;border-radius:3px}
.ql-settings-details-body{display:grid;gap:8px;padding-top:7px;min-width:0;animation:ql-settings-in 160ms ease-out both}
.ql-cookie-fields .ql-input{
  flex:1 1 160px;min-width:0;min-height:32px;box-sizing:border-box;padding:4px 10px;
  border:1px solid var(--ql-border);border-radius:7px;background:var(--ql-inset);color:var(--ql-text);font:inherit;
  transition:border-color 140ms ease-out
}
.ql-cookie-fields .ql-input::placeholder{color:var(--ql-muted)}
.ql-cookie-fields .ql-input:focus-visible{outline:2px solid var(--ql-accent);outline-offset:1px}
.ql-connection-links{justify-content:space-between;margin-top:2px}
@container (min-width: 480px){.ql-settings-windows{grid-template-columns:repeat(2,minmax(0,1fr))}}

/* ── reduced motion: one switch, everything off ───────────────────────── */
@media (prefers-reduced-motion:reduce){
  .ql-panel,.ql-panel > *,.ql-win,.ql-call,.ql-settings,.ql-settings-details-body,
  .ql-preview-value .ql-label,.ql-preview-value .ql-ring,.ql-preview-value .ql-dot{animation:none}
  .ql-bar-fill,.ql-bar-fill.is-grow,.ql-ring,.ql-ring-fill,.ql-dot,.ql-pill,.ql-btn,
  .ql-option span,.ql-cookie-fields .ql-input{transition:none;animation:none}
  .ql-pill:active,.ql-btn:active:not(:disabled){transform:none}
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
    const expiryFormat = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    const historyFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
    const REFRESH_SECONDS_KEY = 'opendesign-runway.refreshSeconds'
    const DETAIL_PREFS_KEY = 'opendesign-runway.detailDisplay'
    const PLAN_DATE_LABELS = Object.freeze({ days: '剩余天数', date: '到期时间', hidden: '隐藏' })
    const PLAN_DATE_MODES = Object.freeze(Object.keys(PLAN_DATE_LABELS))
    const DETAIL_TOGGLES = Object.freeze({
      tier: '套餐档位', wallet: '钱包余额', credits: 'Credits', reset: '重置倒计时', outlook: '用量预测',
    })

    function readStoredDetails() {
      let stored = null
      try {
        stored = JSON.parse(window.localStorage.getItem(DETAIL_PREFS_KEY))
      } catch {}
      const details = { planDate: PLAN_DATE_MODES.includes(stored?.planDate) ? stored.planDate : 'days' }
      for (const field of Object.keys(DETAIL_TOGGLES)) {
        details[field] = typeof stored?.[field] === 'boolean' ? stored[field] : true
      }
      return details
    }

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
        refreshSeconds: readStored(REFRESH_SECONDS_KEY, REFRESH_OPTIONS, String(DEFAULT_REFRESH_SECONDS)),
        details: readStoredDetails(),
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
          const details = patch.details ? { ...state.details, ...patch.details } : state.details
          state = { ...state, ...patch, details }
          if (Object.hasOwn(patch, 'mode')) writeStored(PILL_MODE_KEY, state.mode)
          if (Object.hasOwn(patch, 'indicator')) writeStored(INDICATOR_KEY, state.indicator)
          if (Object.hasOwn(patch, 'refreshSeconds')) writeStored(REFRESH_SECONDS_KEY, state.refreshSeconds)
          if (patch.details) writeStored(DETAIL_PREFS_KEY, JSON.stringify(details))
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
        if (parts.length > 0) return parts.join(' • ')
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

    /** Estimate from the quota window's own anchor and the time its usage was sampled. */
    function outlookLine(entry, sampledAt = Date.now()) {
      const seconds = Number(entry?.durationSeconds)
      const credits = entry?.credits ?? {}
      if (credits.used == null || credits.remaining == null) return null
      const used = Number(credits.used)
      const remaining = Number(credits.remaining)
      const resetAt = Date.parse(entry?.resetAt ?? '')
      const now = Date.now()
      if (!Number.isFinite(resetAt) || resetAt <= now || !Number.isFinite(used) || !Number.isFinite(remaining)) return null
      if (used < 0 || remaining < 0) return null
      if (remaining === 0) return { text: '当前额度已耗尽', tone: 'warn' }
      if (used === 0) return { text: '还没开始消耗', tone: 'ok' }

      const startAt = Date.parse(entry?.windowStart ?? '')
      const anchor = Number.isFinite(startAt) ? startAt : resetAt - seconds * 1000
      const sampleTime = Number.isFinite(sampledAt) ? Math.min(sampledAt, now) : now
      const elapsed = sampleTime - anchor
      if (!Number.isFinite(elapsed) || elapsed <= 0) return null
      if (seconds > 0 && seconds < 86_400 && elapsed < 5 * 60_000) {
        return { text: '窗口刚开始，积累几分钟后再估算', tone: 'ok' }
      }
      const exhaustAt = sampleTime + remaining * elapsed / used
      if (exhaustAt >= resetAt) return { text: '照此速度能撑到重置', tone: 'ok' }
      const minutes = (exhaustAt - now) / 60_000
      if (minutes <= 0) return { text: '按上次读数估计，预计耗尽时间已过', tone: 'warn' }
      const eta = minutes < 1 ? '不到 1 分钟' : minutes < 60
        ? `约 ${Math.round(minutes)} 分钟`
        : `约 ${Math.round(minutes / 60)} 小时`
      return { text: `照此速度，${eta}后耗尽`, tone: 'warn' }
    }

    /** Duration and percentage above the bar, with the optional details below it. */
    function WindowRow({ entry, index, sampledAt, details, inSettings = false }) {
      const label = entry.label?.replace(/^Design Plan\s*·\s*/i, '')
      const pct = typeof entry.remainingPct === 'number' ? entry.remainingPct : null
      const remainingHours = details.reset ? hoursUntil(entry.resetAt) : null
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
      const creditText = details.credits && credits.remaining != null
        ? `Credits ${count(credits.remaining)} / ${count(credits.limit)}`
        : null
      const outlook = details.outlook ? outlookLine(entry, sampledAt) : null
      const resetTitle = remainingHours !== null && remainingHours >= 0
        ? `重置于 ${when(entry.resetAt) ?? ''}`
        : ''
      const ratio = pct === null ? 0 : Math.max(0, Math.min(100, pct)) / 100

      return h('div', {
        className: inSettings ? 'ql-win is-grow' : 'ql-win',
        style: { '--ql-i': index },
      }, [
        h('div', { key: 'head', className: 'ql-win-head' }, [
          h('span', { key: 'n', className: 'ql-win-name', title: label }, label),
          h('span', { key: 'p', className: 'ql-win-pct' }, pct === null ? '不可读' : `${Math.round(pct)}%`),
        ]),
        pct === null
          ? null
          : h('div', {
            key: 'bar',
            className: 'ql-bar',
            role: 'progressbar',
            'aria-label': `${label} 剩余`,
            'aria-valuenow': Math.round(pct),
            'aria-valuemin': 0,
            'aria-valuemax': 100,
          }, h('div', {
            // On the settings page the bar draws itself on arrival; the panel
            // keeps the plain fill, because a pill opened and closed repeatedly
            // must not replay an entrance.
            className: inSettings
              ? `ql-bar-fill is-grow ${toneClass(pct)}`
              : `ql-bar-fill ${toneClass(pct)}`,
            style: inSettings
              ? { '--ql-pct': ratio }
              : { transform: `scaleX(${ratio})` },
          })),
        creditText === null && resetText === null ? null : h('div', { key: 'meta', className: 'ql-win-meta' }, [
          creditText === null ? null : h('span', {
            key: 'credits', className: 'ql-win-credits', title: creditText,
          }, creditText),
          resetText === null ? null : h('span', {
            key: 'reset', className: 'ql-win-reset', title: resetTitle,
          }, resetText),
        ]),
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

    /** Persist the last good snapshot for the conversation pill. */
    function writeCachedSnapshot(body) {
      const { reading } = body
      const usage = reading?.usage
      const cachedBody = Array.isArray(usage?.recent) ? {
        ...body,
        reading: { ...reading, usage: { ...usage, recent: usage.recent.map(({ model, at }) => ({ model, at })) } },
      } : body
      try {
        window.localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify({
          provider: 'opendesign',
          at: Date.now(),
          body: cachedBody,
        }))
      } catch {}
    }

    function snapshotPath(force, seconds) {
      return `${PATHS.snapshot}?interval=${seconds}${force ? '&refresh=1' : ''}`
    }

    function pollSnapshot(read, intervalMs) {
      let stopped = false
      let timer
      async function tick() {
        await read()
        if (!stopped) timer = setTimeout(tick, intervalMs)
      }
      void tick()
      return () => {
        stopped = true
        clearTimeout(timer)
      }
    }

    function AccountSummary({ reading, details }) {
      const tier = details.tier && reading?.tier ? String(reading.tier).toUpperCase() : null
      const amount = reading?.money?.amount
      const walletBalance = details.wallet && typeof amount === 'number'
        ? money(amount, reading.money.currency ?? 'USD') : null
      const rawEnd = reading?.billing?.periodEnd ?? reading?.periodEnd
      const end = details.planDate === 'hidden' ? NaN : Date.parse(rawEnd ?? '')
      const cancelling = reading?.billing?.cancelAtPeriodEnd === true
      const period = Number.isFinite(end) ? expiryFormat.format(end) : null
      if (!tier && period === null && walletBalance === null) return null

      let periodText = period
      if (period !== null && details.planDate === 'days') {
        const days = Math.max(0, Math.ceil((end - Date.now()) / 86_400_000))
        periodText = `${days} ${days === 1 ? 'day' : 'days'} left`
      }
      return h('div', { className: 'ql-account' }, [
        tier ? h('span', { key: 'tier', className: 'ql-plan-tier', title: `套餐 ${tier}` }, tier) : null,
        period !== null ? h('time', {
          key: 'end', className: cancelling ? 'ql-plan-period is-cancelling' : 'ql-plan-period',
          dateTime: new Date(end).toISOString(), title: `${cancelling ? '套餐到期日' : '套餐周期结束'} ${period}`,
        }, periodText) : null,
        walletBalance !== null ? h('span', { key: 'wallet', className: 'ql-account-wallet' }, [
          h('span', { key: 'label', className: 'ql-account-wallet-label' }, '余额'),
          h('span', { key: 'amount', className: 'ql-account-wallet-amount', title: walletBalance }, walletBalance),
        ]) : null,
      ])
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
      const { mode, indicator, refreshSeconds, details } = usePrefs()
      const anchor = React.useRef(null)

      const load = React.useCallback(async (refresh) => {
        if (provider === null) return
        try {
          const result = await call(snapshotPath(refresh, refreshSeconds))
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
      }, [provider, refreshSeconds])

      React.useEffect(() => {
        if (provider === null) return undefined
        return pollSnapshot(() => {
          if (document.visibilityState === 'visible') return load(false)
        }, Number(refreshSeconds) * 1000)
      }, [provider, load, refreshSeconds])

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
      const today = usage?.today ?? null
      const latestCall = Array.isArray(usage?.recent) ? usage.recent[0] : null
      const text = pillText(snapshot, mode)
      const pct = pillPercent(windows, mode)
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
            h('div', { key: 'heading', className: 'ql-heading' }, [
              h('span', { key: 't', className: 'ql-title' }, `${PROVIDER_LABEL} 额度`),
              stale ? h('span', {
                key: 'stale', className: 'ql-stale', 'aria-live': 'polite', title: '旧数据 · 正在刷新',
              }, '正在刷新') : null,
            ]),
            h('a', {
              key: 'a',
              className: 'ql-link',
              href: DASHBOARD,
              target: '_blank',
              rel: 'noreferrer',
            }, '控制台'),
          ]),

          h(AccountSummary, { key: 'account', reading, details }),

          windows.length > 0
            ? h('div', { key: 'wins', className: 'ql-wins' },
              windows.map((entry, index) => h(WindowRow, { key: entry.key, entry, index, sampledAt: reading.queriedAt, details })))
            : h('span', { key: 'nowins', className: 'ql-sub' },
              reading?.message ?? '这个账号当前没有套餐窗口。'),

          today || latestCall ? h('div', { key: 'tail', className: 'ql-tail' }, [
            h('div', { key: 'sep', className: 'ql-sep' }),
            today ? h('div', { key: 'tok', className: 'ql-tokrow' }, [
              h('span', { key: 'k', className: 'ql-tok-k' }, '今日 token'),
              h('span', { key: 'v', className: 'ql-tok-v' }, compactTokens((today.input ?? 0) + (today.output ?? 0))),
            ]) : null,
            latestCall ? h('div', { key: 'latest', className: 'ql-call' }, [
              h('span', { key: 'label', className: 'ql-call-label' }, '上次调用'),
              h('span', { key: 'model', className: 'ql-call-model', title: latestCall.model }, latestCall.model),
              h('time', {
                key: 'time', className: 'ql-call-time', dateTime: latestCall.at,
                title: when(latestCall.at) ?? undefined,
              }, relativeTime(latestCall.at) ?? '—'),
            ]) : null,
          ]) : null,

          reading?.usageError ? h('p', { key: 'uerr', className: 'ql-err' }, reading.usageError) : null,

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

    /** Use the same indicator source in the conversation and its settings preview. */
    function pillPercent(windows, mode) {
      const selected = mode === 'hour' || mode === 'day' ? cycleFor(mode, cyclePair(windows)) : null
      return selected === null ? worstPct(windows) : selected.remainingPct
    }

    function DisplayChoice({ label, options, value, describe, onChange }) {
      const id = React.useId()
      return h('div', { className: 'ql-setting-choice' }, [
        h('span', { key: 'title', id, className: 'ql-setting-choice-title' }, label),
        h('div', { key: 'options', className: 'ql-options', role: 'radiogroup', 'aria-labelledby': id },
          options.map((option) => h('label', { key: option, className: 'ql-option' }, [
            h('input', {
              key: 'radio', type: 'radio', name: id, value: option, checked: value === option,
              onChange: () => onChange(option),
            }),
            h('span', { key: 'label' }, describe(option)),
          ]))),
      ])
    }

    function RecentCalls({ rows, emptyMessage, issue }) {
      const [page, setPage] = React.useState(0)
      const entries = rows.slice(0, RECENT_CALLS_LIMIT)
      const pages = Math.max(1, Math.ceil(entries.length / CALLS_PER_PAGE))
      const currentPage = Math.min(page, pages - 1)
      if (page !== currentPage) setPage(currentPage)
      const start = currentPage * CALLS_PER_PAGE
      return h('section', { className: 'ql-settings-card', 'aria-label': '最近调用' }, [
        h('div', { key: 'head', className: 'ql-settings-head' }, [
          h('h3', { key: 'title', className: 'ql-settings-title' }, '最近调用'),
          entries.length > 0 ? h('span', { key: 'count', className: 'ql-settings-caption' }, `最近 ${entries.length} 条`) : null,
        ]),
        entries.length > 0 ? h('div', { key: 'columns', className: 'ql-history-columns', 'aria-hidden': true }, [
          h('span', { key: 'model' }, '模型'),
          h('span', { key: 'initiator' }, '调用者'),
          h('span', { key: 'time' }, '时间'),
        ]) : null,
        entries.length > 0 ? h('ul', { key: 'rows', className: 'ql-history' },
          entries.slice(start, start + CALLS_PER_PAGE).map((row, index) => {
            const at = Date.parse(row.at)
            const initiator = row.initiator || '未知'
            return h('li', { key: `${row.at}-${start + index}` }, [
              h('span', { key: 'model', className: 'ql-history-model', title: row.model }, row.model),
              h('span', { key: 'initiator', className: 'ql-history-initiator', title: initiator }, [
                h('span', { key: 'label', className: 'ql-history-visually-hidden' }, '调用者 '),
                initiator,
              ]),
              Number.isFinite(at) ? h('time', { key: 'time', dateTime: row.at, title: when(at) }, historyFormat.format(at)) : null,
            ])
          })) : h('p', { key: 'empty', className: 'ql-settings-note' }, emptyMessage),
        issue ? h('p', { key: 'issue', className: 'ql-settings-issue' }, issue) : null,
        pages > 1 ? h('nav', { key: 'pages', className: 'ql-history-nav', 'aria-label': '调用记录分页' }, [
          h('button', { key: 'prev', type: 'button', className: 'ql-btn', disabled: currentPage === 0,
            onClick: () => setPage(currentPage - 1) }, '上一页'),
          h('span', { key: 'page', className: 'ql-settings-caption ql-history-page', 'aria-live': 'polite',
            'aria-label': `第 ${currentPage + 1} 页，共 ${pages} 页` }, `${currentPage + 1} / ${pages}`),
          h('button', { key: 'next', type: 'button', className: 'ql-btn', disabled: currentPage === pages - 1,
            onClick: () => setPage(currentPage + 1) }, '下一页'),
        ]) : null,
      ])
    }

    function SettingsSection() {
      const { mode, indicator, refreshSeconds, details } = usePrefs()
      const cookieHintId = React.useId()
      // The last reading this browser saw, shown before the first fetch returns.
      // A settings page that opens empty for a second reads as broken, and the
      // numbers it is about to show are the ones from the last poll anyway.
      const cached = React.useMemo(readCachedSnapshot, [])
      const [snapshot, setSnapshot] = React.useState(cached === null ? null : cached.body)
      const [refreshError, setRefreshError] = React.useState(null)
      const [refreshing, setRefreshing] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const requestId = React.useRef(0)
      const manualRefresh = React.useRef(false)

      const refresh = React.useCallback(async (force = false) => {
        if (manualRefresh.current) return
        if (force) {
          manualRefresh.current = true
          setRefreshing(true)
        }
        const id = ++requestId.current
        try {
          const result = await call(snapshotPath(force, refreshSeconds))
          if (!result.ok || !result.body?.reading) throw new Error(`无法读取额度（HTTP ${result.status}）。`)
          if (id === requestId.current) {
            setSnapshot(result.body)
            setRefreshError(null)
            // Cache only a real reading: a failure must not overwrite the last
            // good numbers the next open would show.
            if (result.body.reading.status === 'ok') writeCachedSnapshot(result.body)
          }
        } catch (error) {
          if (id === requestId.current) setRefreshError(error instanceof TypeError ? '无法连接 DSH。' : '暂时无法读取额度。')
        } finally {
          if (force) {
            manualRefresh.current = false
            setRefreshing(false)
          }
        }
      }, [refreshSeconds])

      const login = snapshot?.login ?? { state: 'idle' }
      const running = login.state === 'starting' || login.state === 'pending'
      React.useEffect(() => pollSnapshot(refresh, running ? LOGIN_POLL_MS : Number(refreshSeconds) * 1000),
        [refresh, running, refreshSeconds])

      async function signIn() {
        setBusy(true)
        setMessage(null)
        try {
          const result = await call(PATHS.login, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          if (!result.ok || !result.body?.status) throw new Error()
          if (result.body.availability?.available === false) {
            setMessage({ kind: 'bad', text: result.body.availability.reason })
          }
          await refresh()
        } catch {
          setMessage({ kind: 'bad', text: '无法启动登录窗口。' })
        } finally {
          setBusy(false)
        }
      }

      async function cancel() {
        setBusy(true)
        setMessage(null)
        try {
          const result = await call(PATHS.login, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cancel: true }) })
          if (!result.ok || !result.body?.cancelled) throw new Error()
          await refresh()
        } catch {
          setMessage({ kind: 'bad', text: '无法取消登录。' })
        } finally {
          setBusy(false)
        }
      }

      async function bind(event) {
        event.preventDefault()
        const value = draft.trim()
        if (value === '' || busy || running || refreshing) return
        setBusy(true)
        setMessage(null)
        try {
          const result = await call(PATHS.credential, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ cookie: value }),
          })
          if (result.ok && result.body?.ok) {
            setDraft('')
            setMessage({ kind: 'ok', text: 'Cookie 已保存并通过验证。' })
            await refresh()
          } else {
            setMessage({ kind: 'bad', text: result.body?.message ?? `无法保存 Cookie（HTTP ${result.status}）。` })
          }
        } catch {
          setMessage({ kind: 'bad', text: '无法连接 DSH。' })
        } finally {
          setBusy(false)
        }
      }

      async function forget() {
        setBusy(true)
        setMessage(null)
        try {
          const result = await call(PATHS.logout, { method: 'POST' })
          if (!result.ok || !result.body?.ok) throw new Error()
          setMessage({ kind: 'ok', text: '已清除本机浏览器会话。' })
          await refresh()
        } catch {
          setMessage({ kind: 'bad', text: '无法清除本机浏览器会话。' })
        } finally {
          setBusy(false)
        }
      }

      const session = snapshot?.session
      const controlKey = snapshot?.controlKey
      const availability = snapshot?.availability
      const loginUnavailable = availability?.available === false
      const loginFeedback = message?.text ?? (loginUnavailable ? null : login.message)
      const loginTone = message?.kind ?? (login.state === 'failed' ? 'bad' : login.state === 'success' ? 'ok' : null)
      const reading = snapshot?.reading
      const healthy = reading?.status === 'ok'
      const windows = Array.isArray(reading?.windows) ? reading.windows : []
      const today = healthy ? reading.usage?.today : null
      const recent = healthy && Array.isArray(reading.usage?.recent) ? reading.usage.recent : []
      const historyEmpty = !reading ? (refreshError ? '暂时无法读取调用记录。' : '正在读取调用记录…')
        : !session?.set ? '连接 OpenDesign 浏览器会话后可查看调用记录。'
        : reading.usageError || !healthy ? '暂时无法读取调用记录。' : '暂无调用记录。'
      // Cached snapshots keep the original reading's timestamp across polls.
      const readAt = reading?.queriedAt ?? snapshot?.asOf
      const readTime = healthy && Number.isFinite(readAt) ? new Date(readAt) : null
      const readAtIso = readTime?.toISOString()
      const previewText = pillText(snapshot, mode)
      const previewPct = pillPercent(windows, mode)
      const hidden = indicator === 'none' && previewText === ''
      const credentialBusy = busy || running || refreshing

      return h('div', { className: 'ql-settings' }, [
        h('section', { key: 'overview', className: 'ql-settings-card', 'aria-label': '额度概览' }, [
          h('div', { key: 'head', className: 'ql-settings-head' }, [
            h('h3', { key: 'title', className: 'ql-settings-title' }, '额度概览'),
            h('div', { key: 'meta', className: 'ql-settings-meta' }, [
              readTime ? h('time', {
                key: 'time', className: 'ql-settings-caption', dateTime: readAtIso, title: readTime.toLocaleString(),
              }, `更新于 ${relativeTime(readAtIso)}`) : null,
              h('button', {
                key: 'refresh', type: 'button', className: 'ql-btn ql-settings-refresh',
                disabled: refreshing || busy || running, onClick: () => { void refresh(true) },
              }, refreshing ? '刷新中…' : '刷新额度'),
            ]),
          ]),
          refreshError ? h('p', { key: 'error', className: 'ql-settings-issue', role: 'status' },
            healthy ? `${refreshError} 当前显示上次读数。` : refreshError) : null,
          healthy ? [
            h(AccountSummary, { key: 'account', reading, details }),
            windows.length > 0 ? h('div', { key: 'windows', className: 'ql-settings-windows' },
              windows.map((entry, index) => h(WindowRow, {
                key: entry.key, entry, index, sampledAt: reading.queriedAt, details, inSettings: true,
              })))
              : h('p', { key: 'no-windows', className: 'ql-settings-note' },
                reading.channel === 'control' ? '当前来源仅提供钱包余额。' : '当前没有可显示的套餐窗口。'),
            today ? h('div', { key: 'tok', className: 'ql-tokrow' }, [
              h('span', { key: 'label', className: 'ql-tok-k' }, '今日 Token'),
              h('span', { key: 'value', className: 'ql-tok-v' }, compactTokens((today.input ?? 0) + (today.output ?? 0))),
            ]) : null,
          ] : (!refreshError ? h('p', { key: 'status', className: 'ql-settings-note', role: 'status' },
            reading ? (reading.message ?? '暂时读不到额度。') : '正在读取额度…') : null),
          h('label', { key: 'interval', className: 'ql-refresh-preference' }, [
            h('span', { key: 'label', className: 'ql-settings-caption' }, '自动刷新间隔'),
            h('select', { key: 'select', value: refreshSeconds,
              onChange: (event) => prefs.set({ refreshSeconds: event.target.value }) },
            REFRESH_OPTIONS.map((seconds) => h('option', { key: seconds, value: seconds }, `${Number(seconds) / 60} 分钟`))),
          ]),
        ]),

        h('section', { key: 'display', className: 'ql-settings-card', 'aria-label': '输入框胶囊' }, [
          h('h3', { key: 'title', className: 'ql-settings-title' }, '输入框胶囊'),
          h('div', { key: 'preview', className: 'ql-preview' }, [
            h('span', { key: 'label', className: 'ql-settings-caption' }, '实时预览'),
            hidden ? h('span', { key: 'hidden', className: 'ql-settings-caption' }, '胶囊已隐藏')
              : h('span', { key: 'pill', className: 'ql-preview-value', role: 'img', 'aria-label': pillAria(snapshot, mode) }, [
                h(Indicator, { key: 'indicator', mode: indicator, percent: previewPct, tone: toneClass(previewPct) }),
                previewText ? h('span', { key: mode, className: 'ql-label' }, previewText) : null,
              ]),
          ]),
          h(DisplayChoice, {
            key: 'mode', label: '胶囊文字', options: PILL_MODES, value: mode,
            describe: (option) => pillModeLabel(option, windows), onChange: (option) => prefs.set({ mode: option }),
          }),
          h(DisplayChoice, {
            key: 'indicator', label: '状态指示', options: INDICATOR_MODES, value: indicator,
            describe: (option) => INDICATOR_LABEL[option], onChange: (option) => prefs.set({ indicator: option }),
          }),
        ]),

        h('section', { key: 'details', className: 'ql-settings-card', 'aria-label': '额度明细显示' }, [
          h('h3', { key: 'title', className: 'ql-settings-title' }, '额度明细显示'),
          h(DisplayChoice, {
            key: 'date', label: '套餐日期', options: PLAN_DATE_MODES, value: details.planDate,
            describe: (option) => PLAN_DATE_LABELS[option], onChange: (planDate) => prefs.set({ details: { planDate } }),
          }),
          h('div', { key: 'fields', className: 'ql-setting-choice' }, [
            h('span', { key: 'label', className: 'ql-setting-choice-title' }, '显示项目'),
            h('div', { key: 'options', className: 'ql-options', role: 'group', 'aria-label': '显示项目' },
              Object.entries(DETAIL_TOGGLES).map(([field, label]) => h('label', { key: field, className: 'ql-option' }, [
                h('input', {
                  key: 'checkbox', type: 'checkbox', checked: details[field],
                  onChange: (event) => prefs.set({ details: { [field]: event.target.checked } }),
                }),
                h('span', { key: 'label' }, label),
              ]))),
          ]),
        ]),

        h(RecentCalls, { key: 'history', rows: recent, emptyMessage: historyEmpty, issue: reading?.usageError }),

        h('section', { key: 'connection', className: 'ql-settings-card', 'aria-label': '账号连接' }, [
          h('div', { key: 'head', className: 'ql-settings-head' }, [
            h('h3', { key: 'title', className: 'ql-settings-title' }, '账号连接'),
            h('span', { key: 'state', className: session?.set ? 'ql-connection-state is-on' : 'ql-connection-state' },
              session?.set ? '浏览器会话已保存' : session ? '浏览器会话未保存' : '正在检测会话'),
          ]),
          h('div', { key: 'actions', className: 'ql-connection-actions' }, [
            h('button', {
              key: 'login', type: 'button', className: 'ql-btn is-primary',
              disabled: credentialBusy || loginUnavailable, onClick: signIn,
            }, running ? '登录中…' : session?.set ? '重新登录 OpenDesign' : '登录 OpenDesign'),
            running ? h('button', {
              key: 'cancel', type: 'button', className: 'ql-btn', disabled: busy, onClick: cancel,
            }, '取消登录') : null,
          ]),
          h('div', { key: 'feedback', className: 'ql-settings-feedback', role: 'status' }, [
            loginUnavailable ? h('p', { key: 'availability', className: 'ql-settings-note' }, availability.reason) : null,
            loginFeedback && loginFeedback !== availability?.reason ? h('p', {
              key: 'message',
              className: loginTone === 'bad' ? 'ql-settings-issue'
                : loginTone === 'ok' ? 'ql-settings-caption ql-settings-good' : 'ql-settings-caption',
            }, loginFeedback) : null,
          ]),
          h('details', { key: 'manual', className: 'ql-settings-details' }, [
            h('summary', { key: 'label' }, '手动粘贴 Cookie'),
            h('form', { key: 'form', className: 'ql-settings-details-body', onSubmit: bind }, [
              h('p', { key: 'hint', id: cookieHintId, className: 'ql-settings-note' }, '从浏览器复制完整的 Cookie 请求头，保存前会先验证。'),
              h('div', { key: 'fields', className: 'ql-cookie-fields' }, [
                h('input', {
                  key: 'cookie', className: 'ql-input', type: 'password', name: 'opendesign-cookie',
                  value: draft, placeholder: '粘贴 Cookie…', autoComplete: 'off', spellCheck: false,
                  'aria-label': 'OpenDesign Cookie', 'aria-describedby': cookieHintId,
                  onChange: (event) => setDraft(event.target.value),
                }),
                h('button', {
                  key: 'save', type: 'submit', className: 'ql-btn', disabled: credentialBusy || draft.trim() === '',
                }, '验证并保存'),
              ]),
            ]),
          ]),
          h('details', { key: 'source', className: 'ql-settings-details' }, [
            h('summary', { key: 'label' }, '查看数据来源'),
            h('div', { key: 'body', className: 'ql-settings-details-body' }, [
              snapshot?.sourceLine ? h('p', { key: 'source-line', className: 'ql-settings-caption' }, snapshot.sourceLine) : null,
              h('p', { key: 'cookie', className: 'ql-settings-note' },
                `浏览器会话${session?.set ? `已保存（尾号 ${session.tail}）` : session ? '未保存' : '正在检测'}，可读取套餐额度。`),
              h('p', { key: 'key', className: 'ql-settings-note' },
                `controlKey${controlKey?.set ? ` 已找到（尾号 ${controlKey.tail}）` : controlKey ? ` 未找到${controlKey.reason ? ` · ${controlKey.reason}` : ''}` : ' 正在检测'}，仅用于读取钱包。`),
            ]),
          ]),
          h('div', { key: 'links', className: 'ql-connection-links' }, [
            h('a', { key: 'dashboard', className: 'ql-link', href: DASHBOARD, target: '_blank', rel: 'noreferrer' }, '打开控制台 ↗'),
            session?.set ? h('button', {
              key: 'logout', type: 'button', className: 'ql-btn is-quiet', disabled: credentialBusy, onClick: forget,
            }, '清除浏览器会话') : null,
          ]),
        ]),
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
