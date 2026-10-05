// Floating VR menu panel (pause, results, lobby, death screen): a canvas texture on a plane placed in
// front of the player, clicked with a controller laser (trigger) or a hand-tracking pinch.
import * as THREE from 'three';

const W = 1024, H = 640;
const _ray = new THREE.Raycaster();
const _m = new THREE.Matrix4();

export class XRPanel {
  constructor(xr) {
    this.xr = xr;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
    this.mesh.renderOrder = 1000;
    this.mesh.visible = false;
    xr.rig.add(this.mesh);
    this.buttons = [];
    this.hover = null;
    this.onClick = null;
    this.lasers = xr.slots.map((s) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.8, depthTest: false, fog: false }));
      line.renderOrder = 1001; line.visible = false; line.frustumCulled = false;
      s.ray.add(line);
      return line;
    });
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, fog: false }));
    this.dot.renderOrder = 1002; this.dot.visible = false;
    xr.rig.add(this.dot);
    xr.on('select', (slot) => this.select(slot));
  }

  get visible() { return this.mesh.visible; }

  /** spec: { title, lines: [string], buttons: [{ id, label, primary?, danger? }] } */
  show(spec, onClick, reposition = true) {
    this.spec = spec;
    this.onClick = onClick || null;
    this.draw();
    if (reposition || !this.mesh.visible) this.place();
    this.mesh.visible = true;
  }
  /** Redraw the text without moving the panel (e.g. lobby countdown). */
  update(spec) { if (!this.mesh.visible) return; this.spec = { ...this.spec, ...spec }; this.draw(); }
  hide() {
    this.mesh.visible = false; this.dot.visible = false; this.spec = null; this.onClick = null;
    for (const l of this.lasers) l.visible = false;
  }

  /** 1.3 m in front of the head (in play space), at eye height, facing the player. */
  place() {
    const xr = this.xr, h = xr.headLocal, yaw = xr.headYaw;
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    this.mesh.position.set(h.x + dx * 1.3, Math.max(0.9, h.y - 0.05), h.z + dz * 1.3);
    this.mesh.rotation.set(0, yaw, 0);
    this.mesh.updateMatrix();
  }

  draw() {
    const g = this.g, s = this.spec || {};
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(14,22,40,0.92)';
    roundRect(g, 8, 8, W - 16, H - 16, 36); g.fill();
    g.strokeStyle = 'rgba(122,170,255,0.6)'; g.lineWidth = 4; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffd23f'; g.font = 'bold 64px sans-serif';
    g.fillText(s.title || '', W / 2, 84);
    g.fillStyle = '#e8eefc';
    const small = !!s.small;
    g.font = small ? '27px sans-serif' : '34px sans-serif';
    (s.lines || []).forEach((l, i) => g.fillText(String(l).slice(0, small ? 72 : 60), W / 2, small ? 136 + i * 36 : 160 + i * 46, W - 60));
    const btns = s.buttons || [];
    this.buttons = [];
    const cols = btns.length > 3 ? 2 : 1;
    const bw = cols === 2 ? 420 : 520, bh = 74, gap = 18;
    const rows = Math.ceil(btns.length / cols);
    const top = H - 40 - rows * (bh + gap) + gap;
    btns.forEach((b, i) => {
      const c = cols === 2 ? i % 2 : 0, r = cols === 2 ? Math.floor(i / 2) : i;
      const x = cols === 2 ? W / 2 - bw - 10 + c * (bw + 20) : (W - bw) / 2, y = top + r * (bh + gap);
      this.buttons.push({ ...b, x, y, w: bw, h: bh });
      const hov = this.hover === b.id;
      g.fillStyle = b.primary ? (hov ? '#ffe36e' : '#ffd23f') : b.danger ? (hov ? '#ff7a6e' : '#e2483c') : (hov ? '#4f7fe0' : '#2d4f96');
      roundRect(g, x, y, bw, bh, 18); g.fill();
      g.fillStyle = b.primary ? '#1a1a2a' : '#fff'; g.font = 'bold 34px sans-serif';
      g.fillText(b.label, x + bw / 2, y + bh / 2 + 2);
    });
    this.tex.needsUpdate = true;
  }

  /** Per frame: laser pointers + hover highlight. */
  tick() {
    if (!this.mesh.visible) return;
    let hov = null, dotPos = null;
    this.xr.rig.updateMatrixWorld(true);
    this.xr.slots.forEach((s, i) => {
      const laser = this.lasers[i];
      if (!s.connected) { laser.visible = false; return; }
      const hit = this.cast(s);
      laser.visible = true;
      laser.scale.z = hit ? hit.distance : 3;
      if (hit) {
        dotPos = hit.point;
        const b = this.buttonAt(hit.uv);
        if (b) hov = b.id;
      }
    });
    this.dot.visible = !!dotPos;
    if (dotPos) {
      this.dot.position.copy(this.xr.rig.worldToLocal(dotPos.clone()));
      this.dot.rotation.copy(this.mesh.rotation);
      this.dot.translateZ(0.002);
    }
    if (hov !== this.hover) { this.hover = hov; this.draw(); }
  }

  cast(slot) {
    slot.ray.updateWorldMatrix(true, false);
    _m.identity().extractRotation(slot.ray.matrixWorld);
    _ray.ray.origin.setFromMatrixPosition(slot.ray.matrixWorld);
    _ray.ray.direction.set(0, 0, -1).applyMatrix4(_m);
    const hits = _ray.intersectObject(this.mesh, false);
    return hits[0] || null;
  }

  buttonAt(uv) {
    if (!uv) return null;
    const x = uv.x * W, y = (1 - uv.y) * H;
    return this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
  }

  select(slot) {
    if (!this.mesh.visible || !this.onClick) return false;
    const hit = this.cast(slot);
    const b = hit && this.buttonAt(hit.uv);
    if (!b) return false;
    this.xr.pulse(slot, 0.3, 20);
    this.xr.game.audio.ui('click');
    this.onClick(b.id);
    return true;
  }
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
