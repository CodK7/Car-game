// Debug panel (lil-gui) shown with ?debug. Systems register their tunable values here.
import { P } from './params';

type Gui = any;
let ready: Promise<Gui | null> | null = null;
const folders = new Map<string, Gui>();

export function debugGui(): Promise<Gui | null> {
  if (!P.debug || typeof document === 'undefined') return Promise.resolve(null);
  if (!ready) {
    ready = import('three/examples/jsm/libs/lil-gui.module.min.js').then((m) => {
      const gui = new m.GUI({ title: 'Wahiba debug', width: 300 });
      gui.close();
      return gui;
    });
  }
  return ready;
}

async function folder(name: string): Promise<Gui | null> {
  const g = await debugGui();
  if (!g) return null;
  let f = folders.get(name);
  if (!f) {
    f = g.addFolder(name);
    f.close();
    folders.set(name, f);
  }
  return f;
}

/** Register a numeric/boolean/enum field of `obj` in the debug panel. No-op without ?debug. */
export function tun(folderName: string, obj: any, key: string, a?: number | any[] | Record<string, any>, b?: number, step?: number,
  onChange?: (v: any) => void, label?: string): void {
  if (!P.debug) return;
  void folder(folderName).then((f) => {
    if (!f) return;
    const c = typeof a === 'number' ? f.add(obj, key, a, b, step) : a !== undefined ? f.add(obj, key, a) : f.add(obj, key);
    if (label) c.name(label);
    if (onChange) c.onChange(onChange);
    c.listen();
  });
}

export function tunButton(folderName: string, label: string, fn: () => void): void {
  if (!P.debug) return;
  void folder(folderName).then((f) => f?.add({ fn }, 'fn').name(label));
}
