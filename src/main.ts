import { App } from './app';

const loading = document.getElementById('loading')!;
const msg = loading.querySelector('.msg') as HTMLElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;

async function boot(): Promise<void> {
  const app = new App(canvas);
  try {
    await app.init((m) => (msg.textContent = `loading ${m}…`));
    app.start();
    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 700);
    (window as any).__ready = true;
  } catch (e) {
    console.error(e);
    loading.classList.add('err');
    msg.textContent = `Failed to start: ${(e as Error).message}`;
    (window as any).__ready = 'error';
  }
}
void boot();
