// ============================================================================
// Mineblock — sky: colours, fog, sun/moon, stars, clouds, day/night cycle
// ----------------------------------------------------------------------------
//   const sky = new Sky(THREE, scene, camera)
//   sky.update({ dim, time, camPos, renderDist, eyeMedium: 'air'|'water'|'lava' })
// time is seconds; one full day = DAY_LENGTH. time 0 = sunrise.
// Drives LIGHT.uDay / LIGHT.uMin used by the chunk shader patch.
// ============================================================================
import * as THREE from 'three';
import { LIGHT } from './chunkmesh.js';
import { mulberry32 } from './noise.js';

export const DAY_LENGTH = 1200;
const col = (h) => new THREE.Color(h);
const DAY_SKY = col(0x7fb6ff), NIGHT_SKY = col(0x070b22), DUSK = col(0xff9a55);
const NETHER_FOG = col(0x3a0a0a);

function radialTexture(inner, outer, square = false) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  if (square) { g.fillStyle = inner; g.fillRect(14, 14, 36, 36); g.fillStyle = outer; g.fillRect(20, 20, 24, 24); }
  else { const r = g.createRadialGradient(32, 32, 2, 32, 32, 30); r.addColorStop(0, inner); r.addColorStop(1, outer); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}

export class Sky {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.group = new THREE.Group(); scene.add(this.group);
    const mk = (map, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, fog: false, depthWrite: false, depthTest: false, transparent: true })); s.scale.set(size, size, 1); s.renderOrder = -10; this.group.add(s); return s; };
    this.sun = mk(radialTexture('#fffbe0', '#ffd45e', true), 70);
    this.moon = mk(radialTexture('#e8ecff', '#b9c2e6', true), 50);
    // stars
    const rnd = mulberry32(99), N = 500, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u); pos[i * 3] = Math.cos(a) * r * 350; pos[i * 3 + 1] = u * 350; pos[i * 3 + 2] = Math.sin(a) * r * 350; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.renderOrder = -11; this.group.add(this.stars);
    // clouds: 2-D blocky noise on a big plane
    const cc = document.createElement('canvas'); cc.width = cc.height = 128;
    const g = cc.getContext('2d'); const r2 = mulberry32(7);
    const f = new Float32Array(128 * 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const v = Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2) + Math.sin(y * 0.13 + x * 0.05) + (r2() - 0.5) * 0.8 + Math.sin((x + y) * 0.04);
      f[x + y * 128] = v;
    }
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { g.fillStyle = f[x + y * 128] > 0.9 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0)'; g.fillRect(x, y, 1, 1); }
    const ct = new THREE.CanvasTexture(cc); ct.wrapS = ct.wrapT = THREE.RepeatWrapping; ct.magFilter = ct.minFilter = THREE.NearestFilter; ct.repeat.set(4, 4);
    this.cloudMat = new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1536, 1536), this.cloudMat);
    this.clouds.rotation.x = -Math.PI / 2; this.clouds.renderOrder = 4; scene.add(this.clouds);
    this.cloudTex = ct;
    this.ambient = new THREE.AmbientLight(0xffffff, 1.0); scene.add(this.ambient);
    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.6); this.dirLight.position.set(0.4, 1, 0.3); scene.add(this.dirLight);
    this.dayFactor = 1; this.phase = 0;
    this._c = new THREE.Color();
  }

  // 0..1 "how bright is the sky" (used for mob spawn logic and mob tint)
  static brightness(time) {
    const s = Math.sin((time / DAY_LENGTH) * Math.PI * 2);
    const k = Math.min(1, Math.max(0, (s + 0.1) / 0.4));
    return 0.14 + 0.86 * k * k * (3 - 2 * k);
  }

  update({ dim, time, camPos, renderDist, eyeMedium = 'air', dt = 0 }) {
    const fog = this.scene.fog, cam = this.camera;
    if (dim === 'nether') {
      LIGHT.uDay.value = 0; LIGHT.uMin.value = 0.3;
      this.scene.background = NETHER_FOG; fog.color.copy(NETHER_FOG);
      fog.near = 8; fog.far = Math.min(renderDist * 16, 80);
      this.group.visible = false; this.clouds.visible = false;
      this.ambient.intensity = 0.9; this.dirLight.intensity = 0.3; this.dayFactor = 0.6;
    } else {
      const ang = (time / DAY_LENGTH) * Math.PI * 2, sunH = Math.sin(ang);
      const b = Sky.brightness(time); this.dayFactor = b;
      LIGHT.uDay.value = b; LIGHT.uMin.value = 0.11;
      const k = Math.min(1, Math.max(0, (sunH + 0.1) / 0.4));
      this._c.copy(NIGHT_SKY).lerp(DAY_SKY, k * k * (3 - 2 * k));
      const dusk = Math.max(0, 1 - Math.abs(sunH) / 0.28);
      this._c.lerp(DUSK, dusk * 0.45);
      this.scene.background = this._c; fog.color.copy(this._c);
      fog.far = renderDist * 16 - 6; fog.near = fog.far * 0.45;
      this.group.visible = true; this.group.position.copy(camPos);
      this.sun.position.set(Math.cos(ang) * 300, sunH * 300, 60); this.moon.position.set(-Math.cos(ang) * 300, -sunH * 300, -60);
      this.starMat.opacity = Math.max(0, Math.min(1, -sunH * 3));
      this.clouds.visible = true;
      this.clouds.position.set(camPos.x, 120, camPos.z);
      this.cloudTex.offset.set(((camPos.x + time * 1.4) / 1536) * 4, (-camPos.z / 1536) * 4);
      this.cloudMat.color.setScalar(0.35 + 0.65 * b); this.cloudMat.opacity = 0.85;
      this.ambient.intensity = 0.55 + 0.5 * b; this.dirLight.intensity = 0.15 + 0.6 * b;
      this.dirLight.position.set(Math.cos(ang), Math.max(0.2, sunH), 0.3);
    }
    if (eyeMedium === 'water') { fog.color.set(0x1e4fd0); this.scene.background = fog.color; fog.near = 0.1; fog.far = 22; }
    else if (eyeMedium === 'lava') { fog.color.set(0xd84f1a); this.scene.background = fog.color; fog.near = 0; fog.far = 3; }
  }
}
