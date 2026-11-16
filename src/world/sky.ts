// Sky dome: analytic gradient + sun glow + sun disc, using the same skyColor() the fog uses (seamless horizon).
import * as THREE from 'three';
import { atmo, ATMO_GLSL } from './atmosphere';

export class Sky {
  readonly mesh: THREE.Mesh;
  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...atmo },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        ${ATMO_GLSL}
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = skyColor(d);
          float cs = dot(d, uSunDir);
          float disc = smoothstep(0.99990, 0.99996, cs);
          c += uSunColor * disc * 14.0 * smoothstep(-0.02, 0.03, d.y);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor.rgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }
}
