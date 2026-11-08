// ============================================================================
// GÖKYÜZÜ, BOŞLUK VE BULUTLAR
// Gökyüzü: köşe renkli büyük bir küre (doku yok, ucuz).
// Bulutlar: birkaç ikosahedronun birleşimi, tek InstancedMesh, yavaşça kayar.
// Adanın altında derin, mor bir boşluk ve bulut denizi var.
// ============================================================================
import * as THREE from 'three';
import { part, merge, ICO0, ICO1 } from './geo.js';
import { mulberry32 } from '@miknatis/shared';

export const FOG_COLOR = 0xb7c9f2;

export function createSky(scene) {
  const geo = new THREE.SphereGeometry(400, 24, 16);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x3d8cff), hor = new THREE.Color(FOG_COLOR), warm = new THREE.Color(0xffd0a8);
  const below = new THREE.Color(0x6a4fb0), bottom = new THREE.Color(0x140c33);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 400;
    if (y > 0.05) c.copy(hor).lerp(top, Math.min(1, (y - 0.05) / 0.6));
    else if (y > -0.08) c.copy(warm).lerp(hor, (y + 0.08) / 0.13);
    else c.copy(below).lerp(bottom, Math.min(1, (-y - 0.08) / 0.5));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  scene.add(sky);
  // Güneş
  const sun = new THREE.Mesh(new THREE.CircleGeometry(18, 20), new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }));
  sun.position.set(-150, 190, -260);
  sun.lookAt(0, 0, 0);
  scene.add(sun);
  return { sky, sun };
}

export class Clouds {
  constructor(scene) {
    const parts = [];
    const rand = mulberry32(5);
    for (let i = 0; i < 5; i++) {
      parts.push(part(i % 2 ? ICO1 : ICO0, (tri) => (tri % 4 === 0 ? 0xdfe6ff : 0xffffff), (i - 2) * 1.3, rand() * 0.6, (rand() - 0.5) * 1.2, 0, rand() * 3, 0, 1.4 + rand(), 1 + rand() * 0.5, 1.3 + rand(), 0.04));
    }
    const geo = merge(parts);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x4a5070 });
    this.max = 70;
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.frustumCulled = false;
    this.data = [];
    for (let i = 0; i < this.max; i++) {
      const below = i < 46; // çoğu adanın altında: derin bulut denizi
      const a = rand() * Math.PI * 2, d = below ? 15 + rand() * 170 : 120 + rand() * 120;
      this.data.push({
        x: Math.cos(a) * d, z: Math.sin(a) * d,
        y: below ? -22 - rand() * 55 : -6 + rand() * 30,
        s: below ? 3 + rand() * 5 : 4 + rand() * 6, sp: 0.6 + rand() * 1.2,
      });
    }
    this.count = this.max;
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    scene.add(this.mesh);
    this.update(0);
  }

  setCount(n) { this.count = Math.min(this.max, n); }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      const c = this.data[i];
      c.x += c.sp * dt;
      if (c.x > 240) c.x = -240;
      this._p.set(c.x, c.y, c.z);
      this._s.set(c.s, c.s * 0.6, c.s);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
