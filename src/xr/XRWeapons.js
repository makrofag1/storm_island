// VR held items: the weapon model in your hand with real aiming sights — a rear notch + front post
// with a glowing dot (shots travel exactly along that sight line), and on the sniper a working scope
// whose lens shows a magnified render of the world. Bringing the rear sight up to your eye counts as
// aiming down sights (tighter spread), just like holding the left trigger.
import * as THREE from 'three';
import { weaponGeometry, consumableGeometry } from '../world/Models.js';

// sight line height above the grip, rear / front sight positions (held space: -Z = aim direction)
const SIGHTS = {
  ar:      { y: 0.255, rear: -0.1,  front: -0.66, base: 0.135 },  // rear on the carry handle, tall front post
  smg:     { y: 0.195, rear: -0.02, front: -0.4,  base: 0.12 },
  shotgun: { y: 0.18,  rear: -0.04, front: -0.86, base: 0.165 },
  pistol:  { y: 0.185, rear: 0.03,  front: -0.18, base: 0.17 },
  rocket:  { y: 0.4,   rear: -0.02, front: -0.5,  base: 0.29 },
  sniper:  { y: 0.24,  rear: 0.0,   front: -0.34, base: 0.24, scope: true },
};
const GUN_OFFSET = new THREE.Vector3(0, 0.06, 0.03);   // handle in the palm

const darkMat = new THREE.MeshLambertMaterial({ color: 0x1b1f27 });
const dotMat = new THREE.MeshBasicMaterial({ color: 0xff8a1a, fog: false, toneMapped: false });

function box(w, h, d, x, y, z, mat = darkMat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Iron sights for a gun (rear notch: two posts; front: post with a fibre-optic dot on the sight line). */
function ironSights(s) {
  const g = new THREE.Group();
  // rear: base block + two posts, the notch between them frames the front dot
  g.add(box(0.044, 0.012, 0.016, 0, s.y - 0.012, s.rear));
  g.add(box(0.012, 0.024, 0.01, -0.011, s.y, s.rear));
  g.add(box(0.012, 0.024, 0.01, 0.011, s.y, s.rear));
  // front: thin post from the barrel up to the sight line, glowing dot on top
  const h = Math.max(0.012, s.y - s.base);
  g.add(box(0.006, h, 0.008, 0, s.base + h / 2 - 0.004, s.front));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 10, 8), dotMat);
  dot.position.set(0, s.y + 0.002, s.front);
  g.add(dot);
  return g;
}

/** Magnified scope: a narrow-FOV camera renders into a texture shown on the rear lens, plus a reticle. */
export class Scope {
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(320, 320, { depthBuffer: true });
    // Rendered exactly like the headset view (same colour grade, same sRGB output), so every material
    // reuses the shader it already has. With a plain linear target three.js compiled a second variant
    // of each material the first time it showed up in the scope -> the game froze for a moment while
    // you aimed at something new (an enemy, a tracer, an impact).
    this.rt.isXRRenderTarget = true;
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.rt.texture.internalFormat = 'RGBA8'; // keep the encoded colours as they are (no 2nd conversion)
    this.cam = new THREE.PerspectiveCamera(6.5, 1, 0.3, 2400);
    const lensGeo = new THREE.CircleGeometry(0.036, 28);
    // the lens shows those already-encoded pixels unchanged
    this.lens = new THREE.Mesh(lensGeo, new THREE.ShaderMaterial({
      uniforms: { map: { value: this.rt.texture }, uBright: { value: 0.07 } }, // dark glass until it renders
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform float uBright; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(map, vUv).rgb * uBright, 1.0); }',
      fog: false, toneMapped: false,
    }));
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.strokeStyle = '#000'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 128); g.lineTo(108, 128); g.moveTo(148, 128); g.lineTo(256, 128); g.moveTo(128, 0); g.lineTo(128, 108); g.moveTo(128, 148); g.lineTo(128, 256); g.stroke();
    g.lineWidth = 1.5; g.beginPath(); g.moveTo(108, 128); g.lineTo(148, 128); g.moveTo(128, 108); g.lineTo(128, 148); g.stroke();
    g.fillStyle = '#ff3a2a'; g.beginPath(); g.arc(128, 128, 3, 0, Math.PI * 2); g.fill();
    // dark ring at the edge (eye box)
    const grd = g.createRadialGradient(128, 128, 96, 128, 128, 128); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.95)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.reticle = new THREE.Mesh(lensGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    this.reticle.position.z = 0.0008;
    this.group = new THREE.Group();
    this.group.add(this.lens, this.reticle);
    this.active = false;
  }

  /**
   * Render the zoomed view from the scope front along the aim direction. Runs inside the XR frame:
   * XR is switched off for this one render-to-texture pass, the player's rig (hands, HUD, panels) is
   * hidden so it can't block the view.
   */
  render(renderer, scene, pos, dir, hide) {
    this.cam.position.copy(pos);
    this.cam.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
    this.cam.updateMatrixWorld();
    const xrOn = renderer.xr.enabled, prev = renderer.getRenderTarget(), shadowAuto = renderer.shadowMap.autoUpdate;
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, this.cam);
    renderer.setRenderTarget(prev);
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.xr.enabled = xrOn;
    hide.forEach((o, i) => { o.visible = vis[i]; });
    this.lens.material.uniforms.uBright.value = 1;
  }

  dispose() {
    this.rt.dispose();
    this.lens.geometry.dispose(); this.lens.material.dispose();
    this.reticle.material.map.dispose(); this.reticle.material.dispose();
  }
}

/** Held model for an item key ('ar', 'pickaxe', 'c_grenade'...). */
export function makeHeldItem(key) {
  const root = new THREE.Group();
  const isC = key.startsWith('c_');
  const geo = isC ? consumableGeometry(key.slice(2)) : weaponGeometry(key);
  if (isC) geo.scale(0.6, 0.6, 0.6);
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  root.add(mesh);
  const item = { key, root, mesh, sight: null, scope: null, aimY: 0.05, aimZ: -0.1 };
  if (key === 'pickaxe') { mesh.rotation.x = -0.75; mesh.position.set(0, -0.06, 0.06); }
  else if (isC) mesh.position.set(0, -0.02, -0.03);
  else {
    mesh.position.copy(GUN_OFFSET);
    const s = SIGHTS[key];
    if (s) {
      item.sight = s;
      item.aimY = s.y;
      item.aimZ = s.front;
      if (s.scope) {
        item.scope = new Scope();
        item.scope.group.position.set(0, s.y, s.rear + 0.004);
        root.add(item.scope.group);
      } else root.add(ironSights(s));
    } else item.aimZ = geo.boundingBox.min.z + GUN_OFFSET.z;
  }
  return item;
}

export function disposeHeldItem(item) {
  item.root.traverse((o) => { if (o.isMesh && o.geometry && o.material !== darkMat && o.material !== dotMat) { o.geometry.dispose(); } });
  item.mesh.material.dispose();
  if (item.scope) item.scope.dispose();
}
