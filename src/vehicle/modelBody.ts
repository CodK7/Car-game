// Optional imported body model (GLB) that replaces the procedural body when the file exists.
// The GLB is produced by Tools/Models/convert.py from a model the user owns locally; it lives in public/local/
// (git-ignored), so a clean checkout falls back to the procedural body. The converter writes the model in the game's
// body axes (x right, y up, front = -z) with the origin at the midpoint between the axle centres at hub height;
// each material carries `extras` (kind, colour, gloss...) that are mapped onto objMaterial here.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { objMaterial } from '../gfx/objMaterial';
import type { VehicleSpec } from './vehicleSim';

export interface ModelDef {
  /** URL relative to the site root, e.g. "local/patrol_vtc.glb" */
  url: string;
  /** extra vertical offset (m) on top of the hub alignment; + raises the body */
  yOffset?: number;
  /** nose-down positive (deg) */
  pitchDeg?: number;
  /** scale along z so the model's axles land on the preset's wheelbase */
  fitWheelbase?: boolean;
  /** cockpit eye in the model's frame (origin = axle midpoint at hub height) */
  eye?: [number, number, number];
}

interface Extras {
  kind: string;
  color: string;
  gloss: number;
  emissive: number;
  opacity: number;
  shadow: boolean;
  interior: boolean;
}

/** Body-frame transform that puts the model's hub line on the sim's rest wheel centres. */
export function modelPlacement(spec: VehicleSpec, def: ModelDef, hubZ: [number, number]): { pos: THREE.Vector3; scaleZ: number; pitch: number } {
  const zF = -spec.wheelbase * (1 - spec.frontWeightFrac);
  const zR = spec.wheelbase * spec.frontWeightFrac;
  const yRest = -spec.cgHeight + spec.tyre.radius;
  const modelWb = hubZ[1] - hubZ[0];
  const scaleZ = def.fitWheelbase && modelWb > 0.5 ? spec.wheelbase / modelWb : 1;
  const mid = (hubZ[0] + hubZ[1]) / 2;
  return { pos: new THREE.Vector3(0, yRest + (def.yOffset ?? 0), (zF + zR) / 2 - mid * scaleZ), scaleZ, pitch: ((def.pitchDeg ?? 0) * Math.PI) / 180 };
}

function materialFor(x: Extras, paintHex: string, map: THREE.Texture | null): THREE.ShaderMaterial {
  // a baked skin texture already holds the config's paint colours, so it is used as-is (white tint)
  const color = map ? '#ffffff' : x.kind === 'paint' ? paintHex : x.color;
  const transparent = x.opacity < 0.999;
  const m = objMaterial({
    color,
    gloss: x.gloss,
    emissive: x.emissive,
    opacity: x.opacity,
    transparent,
    receiveShadow: !x.interior && !transparent,
    side: THREE.DoubleSide,
    map,
  });
  if (transparent) m.depthWrite = false;
  return m;
}

/**
 * Load the model into `target` (a group already in the scene). On success the procedural children are hidden and
 * `onReady` gets the cockpit eye (body frame) if the def has one. Missing file or a load error keeps the procedural body.
 */
export function attachModel(target: THREE.Group, spec: VehicleSpec, def: ModelDef, paintHex: string, onReady?: (eye: THREE.Vector3 | null) => void): void {
  if (typeof window === 'undefined') return;
  const url = new URL(def.url, document.baseURI).href;
  fetch(url, { method: 'HEAD' })
    .then((r) => {
      if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) throw new Error('no model');
      return new GLTFLoader().loadAsync(url);
    })
    .then((gltf) => {
      const root = gltf.scene;
      const ex = (gltf.parser.json.extras ?? {}) as { hubF_z?: number; hubR_z?: number };
      const pl = modelPlacement(spec, def, [ex.hubF_z ?? -1.48, ex.hubR_z ?? 1.48]);
      const cache = new Map<string, THREE.ShaderMaterial>();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshStandardMaterial;
        const x = (src.userData ?? {}) as Extras;
        const map = src.map && mesh.geometry.getAttribute('uv') ? src.map : null;
        const key = JSON.stringify(x) + (map ? map.uuid : '');
        let m = cache.get(key);
        if (!m) cache.set(key, (m = materialFor(x, paintHex, map)));
        if (map) map.anisotropy = 4;
        src.dispose();
        mesh.material = m;
        if (!x.shadow) mesh.userData.noShadow = true;
        if (m.transparent) mesh.renderOrder = 2;
        mesh.geometry.computeBoundingSphere();
      });
      const holder = new THREE.Group();
      holder.name = 'modelBody';
      holder.position.copy(pl.pos);
      holder.rotation.x = -pl.pitch;
      holder.scale.set(1, 1, pl.scaleZ);
      holder.add(root);
      for (const c of target.children) c.visible = false;
      target.add(holder);
      target.userData.model = true;
      const eye = def.eye ? new THREE.Vector3(def.eye[0], def.eye[1], def.eye[2] * pl.scaleZ).add(pl.pos) : null;
      onReady?.(eye);
    })
    .catch(() => {
      /* no local model: keep the procedural body */
    });
}
