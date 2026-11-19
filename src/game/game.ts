// Game layer (DOM): menu panel (missions, garage, vehicle, livery), mission HUD + gate beacon, photo mode, autosave.
// Keys: B menu · P photo mode (Enter saves a PNG, , and . change the time of day) · Esc closes.
import * as THREE from 'three';
import type { DriveSession } from './driveSession';
import type { Input } from '../core/input';
import type { TimeOfDay } from '../world/atmosphere';
import { loadSave, writeSave, fitPart, buildOf, owns, SaveData } from './save';
import { buildSpec, LIVERIES, SLOTS, SLOT_NAMES, SlotName, peakPowerKW } from './garage';
import { MissionRunner, MISSIONS } from './missions';
import { P } from '../core/params';
import { t, tf, getLang, setLang, isRtl, Lang } from '../core/i18n';
import { PRESETS } from '../vehicle/vehicleSim';

/** player vehicles in menu order (vehicles.json keys) */
export const VEHICLES = Object.keys(PRESETS).filter((k) => !k.startsWith('_'));

const CSS = `
#panel { z-index:5; position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(860px,94vw); max-height:86vh; overflow:auto; background:rgba(24,17,11,.93); border:1px solid var(--line); border-radius:12px; padding:14px 18px; font:13px/1.45 "Segoe UI",system-ui,sans-serif; display:none; }
#panel h2 { margin:0 0 8px; font-size:18px; color:var(--sand); display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap; }
#panel h3 { margin:12px 0 4px; font-size:14px; color:var(--text); }
#panel .row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin:3px 0; }
#panel .lbl { width:130px; color:var(--dim); }
#panel button { background:#3a2a1b; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:4px 9px; cursor:pointer; font:inherit; }
#panel button:hover { background:#4d3722; }
#panel button.on { background:var(--sand); color:var(--ink); border-color:var(--sand); }
#panel button.locked { opacity:.7; }
#panel .m { border:1px solid var(--line); border-radius:8px; padding:6px 9px; margin:5px 0; display:flex; justify-content:space-between; gap:10px; align-items:center; }
#panel .d { color:var(--dim); font-size:12px; }
#panel .card { font:12px/1.5 Consolas,monospace; color:var(--dim); white-space:pre; }
#panel .err { color:var(--bad); min-height:1.3em; }
#panel[dir=rtl] { font-family:"Segoe UI",Tahoma,system-ui,sans-serif; }
#panel[dir=rtl] .card { direction:rtl; white-space:normal; }
`;

export class Game {
  save: SaveData = loadSave();
  missions = new MissionRunner(this.save);
  open = false;
  /** start screen visible: no game keys, physics paused */
  locked = false;
  photo = false;
  /** settings panel (gear button) is open: pause driving like the menu */
  settingsOpen = false;
  private panel: HTMLDivElement;
  private beacon: THREE.Mesh;
  private saveT = 0;
  private wantShot = false;
  private err = '';
  private hidden: HTMLElement[] = [];
  netLine: (() => string) | null = null;
  netMessages: string[] | null = null;

  constructor(
    readonly drive: DriveSession,
    readonly scene: THREE.Scene,
    readonly renderer: THREE.WebGLRenderer,
    readonly tod: TimeOfDay,
    readonly onVehicle: (name: string) => void,
  ) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.panel = document.createElement('div');
    this.panel.id = 'panel';
    document.getElementById('ui')!.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onClick(e));
    const geo = new THREE.CylinderGeometry(1.6, 1.6, 70, 16, 1, true);
    this.beacon = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    this.beacon.userData.noShadow = true;
    this.beacon.visible = false;
    this.beacon.frustumCulled = false;
    scene.add(this.beacon);
    drive.extraHud = () => this.hud();
    window.addEventListener('beforeunload', () => writeSave(this.save));
    // apply the saved build to the starting vehicle
    this.applyVehicle(P.veh ? drive.kind : this.save.vehicle);
    this.applyHelp();
  }

  get busy(): boolean {
    return this.open || this.photo || this.settingsOpen;
  }

  update(dt: number, input: Input): void {
    if (this.locked) {
      this.drive.blocked = true;
      return;
    }
    if (input.hit('KeyB') || (this.open && input.hit('Escape'))) this.toggle();
    if (input.hit('KeyP')) this.setPhoto(!this.photo);
    if (this.photo) {
      if (input.hit('Enter')) this.wantShot = true;
      if (input.down('Comma')) this.tod.hour = Math.max(4.5, this.tod.hour - dt * 0.5);
      if (input.down('Period')) this.tod.hour = Math.min(19.5, this.tod.hour + dt * 0.5);
      if (input.hit('Escape')) this.setPhoto(false);
    }
    this.drive.blocked = this.open || this.settingsOpen;
    this.drive.frozen = this.photo;
    const d = this.drive, m = this.missions;
    const before = m.status;
    if (!this.busy) m.update(dt, d.sim);
    for (const s of m.messages.splice(0)) d.flash(s);
    if (this.netMessages) for (const s of this.netMessages.splice(0)) d.flash(s);
    if (before === 'running' && m.status !== 'running') {
      writeSave(this.save);
      if (m.status === 'won' && d.rec.partnerRole === 'stranded') d.rec.release(false);
    }
    const t = m.target();
    this.beacon.visible = !!t && !this.photo && m.def.type !== 'recovery';
    if (t) this.beacon.position.set(t.x, d.ground.heightAt(t.x, t.z) + 34, t.z);
    this.saveT += dt;
    if (this.saveT > 20) {
      this.saveT = 0;
      writeSave(this.save);
    }
  }

  /** call after the frame is rendered (photo capture needs the fresh drawing buffer) */
  afterRender(): void {
    if (!this.wantShot) return;
    this.wantShot = false;
    const url = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `wahiba_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
    this.drive.flash(t('game.photoSaved'));
  }

  private setPhoto(on: boolean): void {
    this.photo = on;
    if (on) {
      this.open = false;
      this.panel.style.display = 'none';
      this.hidden = ['hud', 'help', 'stats', 'touch', 'gear', 'fps'].map((id) => document.getElementById(id)!).filter((e) => e && e.style.display !== 'none');
      for (const e of this.hidden) e.style.visibility = 'hidden';
      this.drive.cam.orbitHold = true;
      this.drive.flash(t('game.photoHelp'));
    } else {
      for (const e of this.hidden) e.style.visibility = '';
      this.drive.cam.orbitHold = false;
    }
  }

  private toggle(): void {
    this.open = !this.open;
    this.err = '';
    this.panel.style.display = this.open ? 'block' : 'none';
    if (this.open) this.render();
  }

  private hud(): string {
    return this.missionHud() + (this.netLine ? this.netLine() : '');
  }

  private missionHud(): string {
    const m = this.missions;
    if (m.status !== 'running' || m.def.type === 'free') return '\n' + t('hud.credits', this.save.credits);
    const d = m.def, sim = this.drive.sim;
    let line = `\n${tf(d, 'title')}\n${m.time.toFixed(1)}${d.timeLimit ? ' / ' + d.timeLimit : ''} s`;
    const tg = m.target();
    if (tg) {
      const dx = tg.x - sim.pos.x, dz = tg.z - sim.pos.z;
      const dist = Math.hypot(dx, dz);
      const ang = Math.atan2(sim.fwd.x * dz - sim.fwd.z * dx, sim.fwd.x * dx + sim.fwd.z * dz); // + = target to the right
      const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
      const idx = (Math.round(ang / (Math.PI / 4)) + 8) % 8;
      line += `  ${arrows[idx]} ${dist.toFixed(0)} m`;
      if (d.gates && d.gates.length > 1) line += '  ' + t('hud.cp', m.gate + 1, d.gates.length);
    }
    return line;
  }

  // ---------------- garage / vehicle ----------------
  private paint(name: string): string | undefined {
    const id = this.save.livery[name];
    return id ? LIVERIES[id]?.paint : undefined;
  }

  applyVehicle(name: string): void {
    this.save.vehicle = name;
    this.drive.replaceVehicle(buildSpec(name, buildOf(this.save, name)), name, this.paint(name));
    this.onVehicle(name);
  }

  private onClick(e: MouseEvent): void {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const [act, a1, a2] = (b.dataset.a ?? '').split(':');
    const veh = this.drive.kind;
    this.err = '';
    if (act === 'close') return this.toggle();
    if (act === 'veh') this.applyVehicle(a1);
    if (act === 'lang') this.setLanguage(a1 as Lang);
    if (act === 'part') {
      if (Math.abs(this.drive.sim.speed) > 1) this.err = t('game.stopParts');
      else {
        const r = fitPart(this.save, veh, a1 as SlotName, a2);
        if (r) this.err = r;
        else this.applyVehicle(veh);
      }
    }
    if (act === 'livery') {
      this.save.livery[veh] = a1;
      this.applyVehicle(veh);
    }
    if (act === 'start') {
      const d = this.drive;
      d.rec.release(false);
      d.rec.dismissPartner();
      const def = this.missions.start(a1, d.sim, d.ground);
      d.grid.follow(d.sim.pos.x, d.sim.pos.z, true);
      d.sim.setPressure(d.sim.wheels[0].pressurePsi);
      if (this.missions.stranded && def.stranded) {
        d.rec.partner = this.missions.stranded;
        d.rec.partnerRole = 'stranded';
        d.rec.partnerKind = def.stranded.vehicle;
        d.rec.partnerPaint = LIVERIES[def.stranded.livery]?.paint;
      }
      this.toggle();
      return;
    }
    if (act === 'stop') {
      this.missions.stop();
      this.drive.rec.release(false);
      this.drive.rec.dismissPartner();
    }
    writeSave(this.save);
    this.render();
  }

  private render(): void {
    const s = this.save, veh = this.drive.kind, spec = this.drive.sim.spec;
    const m = this.missions;
    const btn = (a: string, label: string, on = false, cls = '') => `<button data-a="${a}" class="${on ? 'on' : ''} ${cls}">${label}</button>`;
    let h = `<h2><span>${t('menu.title')}</span><span>${t('menu.credits')} <b>${s.credits}</b> · ${t('menu.missionsCount', s.done.length, MISSIONS.length - 1)} · ${btn('close', t('menu.close'))}</span></h2>`;
    h += `<div class="row"><span class="lbl">${t('menu.language')}</span>${btn('lang:ar', 'العربية', getLang() === 'ar')}${btn('lang:en', 'English', getLang() === 'en')}</div>`;
    h += `<div class="err">${this.err}</div>`;
    h += `<h3>${t('menu.missions')}</h3>`;
    if (m.status === 'running' && m.def.type !== 'free') h += `<div class="row">${t('menu.running', tf(m.def, 'title'))} ${btn('stop', t('menu.stop'))}</div>`;
    for (const d of MISSIONS) {
      const best = s.best[d.id];
      h += `<div class="m"><div><b>${tf(d, 'title')}</b>${s.done.includes(d.id) ? ' ✓' : ''}<div class="d">${tf(d, 'desc')}${d.reward ? t('menu.reward', d.reward) : ''}${d.goldTime ? t('menu.gold', d.goldTime) : ''}${best !== undefined ? t('menu.best', best.toFixed(1)) : ''}</div></div>${btn('start:' + d.id, t('menu.start'))}</div>`;
    }
    h += `<h3>${t('menu.vehicle')}</h3><div class="row">${VEHICLES.map((k) => btn('veh:' + k, tf(PRESETS[k], 'name'), veh === k)).join('')}</div>`;
    const lockers = `${spec.driveline.rearLocker ? 'R' : '-'}${spec.driveline.frontLocker ? 'F' : '-'}`;
    h += `<div class="card">${t('menu.card', spec.mass.toFixed(0), peakPowerKW(spec).toFixed(0), spec.engine.turbo ? t('menu.turbo') : '', (spec.tyre.width * 1000).toFixed(0), (spec.susp.front.travel * 1000).toFixed(0), (spec.susp.rear.travel * 1000).toFixed(0), spec.gearbox.final.toFixed(2), spec.gearbox.lowRange.toFixed(2), lockers)} · ${driveText(spec)}</div>`;
    h += `<h3>${t('menu.garage')}</h3>`;
    const build = buildOf(s, veh);
    for (const slot of SLOT_NAMES) {
      h += `<div class="row"><span class="lbl">${tf(SLOTS[slot], 'label')}</span>`;
      for (const [id, o] of Object.entries(SLOTS[slot].options)) {
        const own = owns(s, veh, slot, id);
        h += btn(`part:${slot}:${id}`, `${tf(o, 'label')}${own ? '' : ` · ${o.price}`}`, build[slot] === id, own ? '' : 'locked');
      }
      h += `</div>`;
    }
    h += `<div class="row"><span class="lbl">${t('menu.livery')}</span>`;
    for (const [id, l] of Object.entries(LIVERIES)) h += btn('livery:' + id, `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${l.paint};margin-inline-end:5px"></span>${tf(l, 'label')}`, (s.livery[veh] ?? '') === id);
    h += `</div><div class="d" style="margin-top:10px">${t('menu.help')}</div>`;
    this.panel.dir = isRtl() ? 'rtl' : 'ltr';
    this.panel.innerHTML = h;
  }
  /** switch the UI language (start screen and menu) and refresh every text on screen */
  setLanguage(l: Lang): void {
    setLang(l);
    this.applyHelp();
    if (this.open) this.render();
  }

  applyHelp(): void {
    const help = document.getElementById('help');
    if (help) {
      help.textContent = t('help.drive') + t('help.game');
      help.dir = isRtl() ? 'rtl' : 'ltr';
    }
    const hud = document.getElementById('hud');
    if (hud) hud.dir = isRtl() ? 'rtl' : 'ltr';
  }
}

/** one-line drive description for menus */
export function driveText(spec: { driveline: { fwd?: boolean; modes?: string[] } }): string {
  if (spec.driveline.fwd) return t('drive.fwd');
  const m = spec.driveline.modes ?? ['2H', '4H', '4L'];
  return m.includes('2H') ? t('drive.4wd') : t('drive.full');
}
