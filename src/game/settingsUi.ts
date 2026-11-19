// Settings (gear button, top-left, also on the start screen): quality, FPS limit, resolution, FPS counter,
// touch controls, fullscreen, language. Values live in src/core/settings.ts (saved in localStorage).
import type { App } from '../app';
import { Settings, defaultSettings, sanitize, isMobileDevice, FPS_OPTIONS, SCALE, TouchMode } from '../core/settings';
import type { QualityName } from '../core/params';
import { t, getLang, setLang, isRtl, onLangChange, Lang } from '../core/i18n';

const CSS = `
#gear { position:fixed; left:calc(8px + env(safe-area-inset-left)); top:calc(8px + env(safe-area-inset-top)); z-index:60; width:42px; height:42px; border-radius:10px; border:1px solid var(--line); background:var(--panel); color:var(--text); font-size:22px; line-height:1; cursor:pointer; padding:0; touch-action:manipulation; }
#gear:hover { background:rgba(80,58,36,.95); }
#fps { direction:ltr; position:fixed; left:calc(58px + env(safe-area-inset-left)); top:calc(12px + env(safe-area-inset-top)); z-index:60; background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:4px 8px; font:600 13px/1.4 Consolas,monospace; color:var(--ok); pointer-events:none; display:none; }
#settings { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:61; width:min(520px,calc(100vw - 24px)); max-height:calc(100dvh - 24px); overflow:auto; box-sizing:border-box; background:rgba(24,17,11,.96); border:1px solid var(--line); border-radius:12px; padding:14px 16px; font:14px/1.45 "Segoe UI",Tahoma,system-ui,sans-serif; color:var(--text); display:none; -webkit-overflow-scrolling:touch; }
#settings h2 { margin:0 0 6px; font-size:19px; color:var(--sand); display:flex; justify-content:space-between; align-items:center; gap:10px; }
#settings h3 { margin:12px 0 5px; font-size:14px; font-weight:600; color:var(--dim); }
#settings .row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
#settings button { font:inherit; background:#3a2a1b; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:7px 12px; min-height:38px; cursor:pointer; touch-action:manipulation; }
#settings button:hover { background:#4d3722; }
#settings button.on { background:var(--sand); color:var(--ink); border-color:var(--sand); font-weight:600; }
#settings input[type=range] { flex:1; min-width:140px; accent-color:var(--sand); height:32px; }
#settings .val { font:13px Consolas,monospace; color:var(--text); min-width:120px; }
#settings .note { color:var(--dim); font-size:12px; margin-top:4px; }
`;

export class SettingsUi {
  private btn: HTMLButtonElement;
  private panel: HTMLDivElement;
  open = false;
  private sawTouch = false;
  /** called when the touch-controls visibility changes */
  onTouch: ((on: boolean) => void) | null = null;

  constructor(private app: App) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.btn = document.createElement('button');
    this.btn.id = 'gear';
    this.btn.textContent = '⚙';
    this.btn.addEventListener('click', () => this.toggle());
    this.panel = document.createElement('div');
    this.panel.id = 'settings';
    this.panel.addEventListener('click', (e) => this.onClick(e));
    this.panel.addEventListener('input', (e) => this.onInput(e));
    document.body.append(this.btn, this.panel);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.toggle();
    });
    // Touch "auto": show the on-screen controls on phones/tablets, or as soon as a finger touches the screen
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !this.sawTouch) {
        this.sawTouch = true;
        this.applyTouch();
      }
    }, { passive: true });
    onLangChange(() => {
      this.btn.title = t('set.title');
      if (this.open) this.render();
    });
    this.btn.title = t('set.title');
    this.applyTouch();
  }

  get touchOn(): boolean {
    const m = this.app.settings.touch;
    return m === 'on' || (m === 'auto' && (this.sawTouch || isMobileDevice()));
  }

  private applyTouch(): void {
    const on = this.touchOn;
    document.documentElement.classList.toggle('touch', on);
    this.onTouch?.(on);
  }

  toggle(): void {
    this.open = !this.open;
    this.panel.style.display = this.open ? 'block' : 'none';
    if (this.app.game) this.app.game.settingsOpen = this.open;
    if (this.open) this.render();
  }

  private update(patch: Partial<Settings>): void {
    this.app.applySettings(sanitize({ ...this.app.settings, ...patch }, this.app.settings));
    this.applyTouch();
    this.render();
  }

  private onClick(e: MouseEvent): void {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const [k, v] = (b.dataset.s ?? '').split(':');
    if (k === 'close') return this.toggle();
    if (k === 'quality') this.update({ quality: v as QualityName });
    if (k === 'fps') this.update({ fpsCap: Number(v) });
    if (k === 'scaleAuto') this.update({ scale: 0 });
    if (k === 'showFps') this.update({ showFps: v === '1' });
    if (k === 'touch') this.update({ touch: v as TouchMode });
    if (k === 'reset') this.update(defaultSettings());
    if (k === 'lang') {
      if (this.app.game) this.app.game.setLanguage(v as Lang);
      else setLang(v as Lang);
    }
    if (k === 'full') void this.fullscreen();
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (el.dataset.s !== 'scale') return;
    const s = sanitize({ ...this.app.settings, scale: Number(el.value) }, this.app.settings);
    this.app.applySettings(s);
    const val = this.panel.querySelector('.val');
    if (val) val.textContent = this.scaleText();
  }

  private scaleText(): string {
    const [w, h] = this.app.renderSize();
    const pct = Math.round(this.app.quality.q.renderScale * 100);
    return `${pct}%${w ? ` · ${w}×${h}` : ''}`;
  }

  private async fullscreen(): Promise<void> {
    const d = document as any, el = document.documentElement as any;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) await (d.exitFullscreen ?? d.webkitExitFullscreen).call(d);
      else {
        await (el.requestFullscreen ?? el.webkitRequestFullscreen).call(el);
        await (screen.orientation as any)?.lock?.('landscape').catch(() => {});
      }
    } catch (err) {
      console.warn('fullscreen failed', err);
    }
    setTimeout(() => this.render(), 300);
  }

  private render(): void {
    const s = this.app.settings;
    const btn = (a: string, label: string, on = false) => `<button data-s="${a}" class="${on ? 'on' : ''}">${label}</button>`;
    const d = document as any;
    const canFull = !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
    const isFull = !!(d.fullscreenElement || d.webkitFullscreenElement);
    const scale = s.scale || this.app.quality.q.renderScale;
    let h = `<h2><span>${t('set.title')}</span>${btn('close', '✕')}</h2>`;
    h += `<h3>${t('set.quality')}</h3><div class="row">${(['auto', 'low', 'medium', 'high'] as const).map((q) => btn('quality:' + q, t('set.q.' + q), s.quality === q)).join('')}</div>`;
    if (s.quality === 'auto') h += `<div class="note">${t('set.autoNow', t('set.q.' + this.app.quality.name))}</div>`;
    h += `<h3>${t('set.fps')}</h3><div class="row">${FPS_OPTIONS.map((f) => btn('fps:' + f, f ? String(f) : t('set.noLimit'), s.fpsCap === f)).join('')}</div>`;
    h += `<h3>${t('set.res')}</h3><div class="row">${btn('scaleAuto', t('set.q.auto'), s.scale === 0)}<input type="range" data-s="scale" min="${SCALE.min}" max="${SCALE.max}" step="${SCALE.step}" value="${scale}"><span class="val" dir="ltr">${this.scaleText()}</span></div>`;
    h += `<div class="note">${t('set.resNote')}</div>`;
    h += `<h3>${t('set.showFps')}</h3><div class="row">${btn('showFps:1', t('set.on'), s.showFps)}${btn('showFps:0', t('set.off'), !s.showFps)}</div>`;
    h += `<h3>${t('set.touch')}</h3><div class="row">${(['auto', 'on', 'off'] as const).map((m) => btn('touch:' + m, t('set.t.' + m), s.touch === m)).join('')}</div>`;
    h += `<h3>${t('set.lang')}</h3><div class="row">${btn('lang:ar', 'العربية', getLang() === 'ar')}${btn('lang:en', 'English', getLang() === 'en')}</div>`;
    h += `<h3></h3><div class="row">${canFull ? btn('full', isFull ? t('set.fullOff') : t('set.fullOn')) : ''}${btn('reset', t('set.reset'))}</div>`;
    this.panel.dir = isRtl() ? 'rtl' : 'ltr';
    this.panel.innerHTML = h;
  }
}
