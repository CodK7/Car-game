// Boot: start screen (language + car choice) while the world loads behind it, then hand over to the App.
// Automation (puppeteer: navigator.webdriver) and ?play skip the start screen so scripts see the game directly.
import { App } from './app';
import { P } from './core/params';
import { t, tf, getLang, setLang, applyDocLang, onLangChange, Lang } from './core/i18n';
import { PRESETS } from './vehicle/vehicleSim';
import { peakPowerKW } from './game/garage';
import { VEHICLES, driveText } from './game/game';
import { loadSave } from './game/save';

const loading = document.getElementById('loading')!;
const msg = loading.querySelector('.msg') as HTMLElement;
const carsEl = loading.querySelector('.cars') as HTMLElement;
const goBtn = loading.querySelector('.go') as HTMLButtonElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const skip = P.raw.has('play') || (typeof navigator !== 'undefined' && navigator.webdriver === true);

let chosen = P.veh && PRESETS[P.veh] ? P.veh : loadSave().vehicle;
if (!PRESETS[chosen]) chosen = 'patrol';
let stage = '';
let app: App | null = null;
let ready = false;

function stageText(m: string): string {
  const hm = /^heightmap (.*)$/.exec(m);
  if (hm) return t('load.heightmap', hm[1]);
  return t('load.' + m);
}

function renderTexts(): void {
  applyDocLang();
  for (const el of loading.querySelectorAll<HTMLElement>('[data-i]')) el.textContent = t(el.dataset.i!);
  for (const b of loading.querySelectorAll<HTMLButtonElement>('[data-lang]')) b.classList.toggle('on', b.dataset.lang === getLang());
  carsEl.innerHTML = VEHICLES.map((k) => {
    const s = PRESETS[k];
    const kw = peakPowerKW(s);
    return `<button class="car${k === chosen ? ' on' : ''}" data-car="${k}"><b>${tf(s, 'name')}</b><span>${t('start.power', s.engineLayout, Math.round(kw * 1.341), s.mass)}</span><span>${driveText(s)}</span></button>`;
  }).join('');
  if (!loading.classList.contains('err')) msg.textContent = ready ? '' : t('start.loading', stageText(stage || 'manifest'));
}

loading.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  if (b.dataset.lang) {
    if (app?.game) app.game.setLanguage(b.dataset.lang as Lang);
    else setLang(b.dataset.lang as Lang);
  } else if (b.dataset.car) {
    chosen = b.dataset.car;
    if (app?.game && app.game.drive.kind !== chosen) app.game.applyVehicle(chosen);
    renderTexts();
  } else if (b === goBtn) enter();
});
onLangChange(() => renderTexts());

function enter(): void {
  if (!ready) return;
  if (app?.game) {
    if (app.game.drive.kind !== chosen) app.game.applyVehicle(chosen);
    app.game.locked = false;
  }
  loading.style.opacity = '0';
  loading.style.pointerEvents = 'none';
  setTimeout(() => loading.remove(), 700);
  canvas.focus();
}

async function boot(): Promise<void> {
  renderTexts();
  app = new App(canvas);
  try {
    await app.init((m) => {
      stage = m;
      msg.textContent = t('start.loading', stageText(m));
    });
    if (app.game) {
      app.game.locked = !skip;
      if (app.game.drive.kind !== chosen && !P.veh) app.game.applyVehicle(chosen);
    }
    app.start();
    ready = true;
    goBtn.disabled = false;
    loading.classList.add('ready');
    renderTexts();
    (window as any).__ready = true;
    if (skip || app.flyMode) enter();
  } catch (e) {
    console.error(e);
    loading.classList.add('err');
    msg.textContent = t('start.failed', (e as Error).message);
    (window as any).__ready = 'error';
  }
}
void boot();
