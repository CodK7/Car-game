// Measures the GPU alternative to the CPU deformation grid: a render-target stamp pass plus the readback the physics
// would need every frame (sync readPixels). Usage: node tests/measure_deform_gpu.mjs
import { startServer, launch, openGame } from './browser.mjs';

const server = await startServer();
const browser = await launch({ headless: false, width: 1280, height: 720 });
try {
  const { page } = await openGame(browser, `${server.url}?quality=medium&mode=fly&mute`);
  await page.waitForFunction('window.__app && window.__app.renderer && window.__THREE', { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 3000));
  const r = await page.evaluate(async () => {
    const THREE = window.__THREE;
    const app = window.__app;
    const renderer = app.renderer;
    const out = [];
    for (const n of [512, 1024, 2048]) {
      const rt = new THREE.WebGLRenderTarget(n, n, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
      const scene = new THREE.Scene();
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const mat = new THREE.ShaderMaterial({ uniforms: { uP: { value: new THREE.Vector4() } }, vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: 'uniform vec4 uP; void main(){ vec2 d = gl_FragCoord.xy - uP.xy; float g = exp(-dot(d,d)/(uP.z*uP.z)); gl_FragColor = vec4(-0.1*g, g, 0., 1.); }', blending: THREE.AdditiveBlending, transparent: true });
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
      const buf = new Uint16Array(64 * 64 * 4);
      const gl = renderer.getContext();
      const prev = renderer.getRenderTarget();
      const frames = 60;
      let tStamp = 0, tRead = 0;
      for (let f = 0; f < frames; f++) {
        renderer.setRenderTarget(rt);
        let t0 = performance.now();
        for (let w = 0; w < 4; w++) { mat.uniforms.uP.value.set(n / 2 + w * 3, n / 2 + f, 3, 0); renderer.render(scene, cam); }
        gl.finish();
        tStamp += performance.now() - t0;
        t0 = performance.now();
        renderer.readRenderTargetPixels(rt, n / 2 - 32, n / 2 - 32, 64, 64, buf);
        tRead += performance.now() - t0;
      }
      renderer.setRenderTarget(prev);
      rt.dispose();
      out.push(`n=${n} gpuStamp(4 full-screen passes + finish)=${(tStamp / frames).toFixed(2)}ms readback64x64=${(tRead / frames).toFixed(2)}ms`);
    }
    return out;
  });
  for (const l of r) console.log('GPU ' + l);
} finally {
  await browser.close();
  await server.close();
}
