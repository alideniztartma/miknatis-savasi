// ============================================================================
// ÇİZİCİ (Renderer) — Three.js sahnesi, kamera, ışıklar ve otomatik kalite.
// Performans kuralları:
//   - devicePixelRatio en fazla 1.5
//   - Tek yönlü ışık + 1024'lük küçük gölge haritası
//   - FPS 50'nin altına düşerse gölgeler ve parçacıklar otomatik azaltılır
// ============================================================================
import * as THREE from 'three';
import { buildArenaLayout } from '@miknatis/shared';
import { ArenaMesh } from './arena.js';
import { createSky, Clouds, FOG_COLOR } from './sky.js';
import { ItemMeshes } from './items.js';
import { PlayerMeshes } from './players.js';
import { Effects } from './effects.js';

export class Renderer {
  constructor(container) {
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({ antialias: dpr < 1.5, powerPreference: 'high-performance' });
    this.maxDpr = Math.min(dpr, 1.5);
    this.renderer.setPixelRatio(this.maxDpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(FOG_COLOR, 70, 330);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 900);
    this.baseFov = 72;

    // Işıklar: gökyüzü/yer yarıküre ışığı + tek yönlü güneş (gölgeli)
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x6b4f7a, 1.25));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    sun.position.set(-18, 34, -12);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 5; sc.far = 80;
    sun.shadow.bias = -0.0015;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    // Tüm opak nesneler aynı malzeme ayarını paylaşır: köşe renkli, düz gölgeli (low-poly)
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

    this.layout = buildArenaLayout();
    createSky(this.scene);
    this.clouds = new Clouds(this.scene);
    this.arena = new ArenaMesh(this.scene, this.layout, this.material);
    this.items = new ItemMeshes(this.scene, this.material);
    this.players = new PlayerMeshes(this.scene, this.material);
    this.effects = new Effects(this.scene);

    // Otomatik kalite
    this.quality = 2;
    this.effects.setQuality(2);
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 60;
    this.lowStreak = 0;
    this.qualityLocked = false;

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** FPS'i ölç; 50'nin altında kalırsa kaliteyi bir kademe düşür. */
  measure(dt, playing) {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      if (playing && !document.hidden && this.fps < 50) this.lowStreak++;
      else this.lowStreak = 0;
      if (this.lowStreak >= 3 && this.quality > 0) {
        this.setQuality(this.quality - 1);
        this.lowStreak = 0;
      }
    }
  }

  setQuality(q) {
    this.quality = q;
    // 1: gölgeler kapalı, daha az parçacık. 0: ayrıca daha düşük çözünürlük, az bulut.
    this.sun.castShadow = q >= 2;
    this.effects.setQuality(q);
    this.clouds.setCount(q >= 2 ? 70 : q === 1 ? 45 : 25);
    this.renderer.setPixelRatio(q >= 1 ? this.maxDpr : 1);
    this.resize();
    console.log('[kalite] seviye', q);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  get drawCalls() { return this.renderer.info.render.calls; }
  get triangles() { return this.renderer.info.render.triangles; }
}
