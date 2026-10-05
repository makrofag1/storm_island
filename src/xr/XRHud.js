// VR HUD: a watch-style panel on the off-hand wrist (health, shield, ammo, materials, hotbar, minimap,
// storm) plus a head-locked message strip low in the view (toasts, big announcements, pickup prompts)
// and a red damage-direction ring. Canvases are redrawn ~10x per second, not every frame.
import * as THREE from 'three';
import { WEAPONS, CONSUMABLES } from '../combat/Items.js';
import { RARITIES } from '../core/config.js';
import { roundRect } from './XRPanel.js';

const strip = (h) => String(h).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function canvasPlane(w, h, cw, ch, order) {
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  return { canvas, g: canvas.getContext('2d'), tex, mesh };
}

export class XRHud {
  constructor(match, xr) {
    this.match = match;
    this.xr = xr;
    // wrist watch (parented to the off-hand grip each frame)
    this.wrist = canvasPlane(0.17, 0.1275, 512, 384, 990);
    this.wristRoot = new THREE.Group();
    this.wristRoot.add(this.wrist.mesh);
    this.wrist.mesh.position.set(0, 0.035, 0.09);
    this.wrist.mesh.rotation.set(-1.15, 0, 0);
    // head-locked strip
    this.strip = canvasPlane(0.95, 0.2375, 1024, 256, 995);
    this.strip.mesh.position.set(0, -0.36, -1.4);
    this.strip.mesh.rotation.set(0.25, 0, 0);
    // damage ring
    this.ring = canvasPlane(0.9, 0.9, 256, 256, 994);
    this.ring.mesh.position.set(0, 0, -1.2);
    xr.game.camera.add(this.strip.mesh, this.ring.mesh);
    this.toasts = [];
    this.kills = [];
    this.center = null;
    this.t = 0; this.ringT = 0;
    this.dirty = true;
    this.big = false;
  }

  dispose() {
    for (const p of [this.wrist, this.strip, this.ring]) { p.mesh.removeFromParent(); p.tex.dispose(); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    this.wristRoot.removeFromParent();
  }

  // hooks called by the 2D HUD
  toast(text, color) { this.toasts.push({ text: strip(text), color: color || '#fff', life: 2.4 }); if (this.toasts.length > 3) this.toasts.shift(); this.dirty = true; }
  centerMessage(text, sub, dur) { this.center = { text: strip(text), sub: strip(sub || ''), life: dur || 3 }; this.dirty = true; }
  killfeed(html) { this.kills.unshift({ text: strip(html), life: 6 }); if (this.kills.length > 3) this.kills.pop(); }

  update(dt, offSlot, mapHeld) {
    // wrist follows the off hand; hidden when that controller is missing
    if (offSlot && offSlot.connected) {
      if (this.wristRoot.parent !== offSlot.grip) offSlot.grip.add(this.wristRoot);
      this.wristRoot.visible = true;
      const k = mapHeld ? 2.2 : 1;
      if (this.big !== mapHeld) { this.big = mapHeld; this.wrist.mesh.scale.setScalar(k); this.wrist.mesh.position.set(0, 0.035 + (k - 1) * 0.06, 0.09 + (k - 1) * 0.02); }
    } else this.wristRoot.visible = false;
    for (const t of this.toasts) t.life -= dt;
    const n = this.toasts.length;
    this.toasts = this.toasts.filter((t) => t.life > 0);
    if (this.toasts.length !== n) this.dirty = true;
    for (const k of this.kills) k.life -= dt;
    this.kills = this.kills.filter((k) => k.life > 0);
    if (this.center) { this.center.life -= dt; if (this.center.life <= 0) { this.center = null; this.dirty = true; } }
    this.t -= dt;
    if (this.t <= 0) { this.t = 0.1; this.drawWrist(); this.drawStrip(); }
    this.ringT -= dt;
    if (this.ringT <= 0) { this.ringT = 0.05; this.drawRing(); }
  }

  drawWrist() {
    const m = this.match, p = m.player, ctrl = m.controller, hud = m.hud, g = this.wrist.g;
    const W = 512, H = 384;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,16,30,0.86)'; roundRect(g, 4, 4, W - 8, H - 8, 28); g.fill();
    // minimap (from the 2D HUD's canvas, already drawn this frame)
    g.save(); g.beginPath(); g.arc(102, 104, 90, 0, Math.PI * 2); g.clip();
    g.drawImage(hud.el.minimap, 12, 14, 180, 180);
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 3; g.beginPath(); g.arc(102, 104, 90, 0, Math.PI * 2); g.stroke();
    // bars
    const bar = (y, v, col, label) => {
      g.fillStyle = 'rgba(255,255,255,0.12)'; roundRect(g, 214, y, 280, 30, 8); g.fill();
      g.fillStyle = col; roundRect(g, 214, y, Math.max(0, Math.min(1, v / 100)) * 280, 30, 8); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(label + ' ' + Math.ceil(v), 222, y + 16);
    };
    bar(20, p.shield, '#3f9cff', '🛡');
    bar(58, p.health, '#59d35a', '♥');
    g.font = 'bold 24px sans-serif'; g.fillStyle = '#e8eefc'; g.textAlign = 'left';
    g.fillText(`👤 ${m.aliveCount}   ☠ ${p.stats.kills}`, 214, 112);
    // ammo / item
    const cur = p.inv.current();
    g.font = 'bold 40px sans-serif'; g.textAlign = 'right';
    if (ctrl.buildMode) { g.fillStyle = '#7ec8ff'; g.fillText(`BUILD · ${ctrl.material.toUpperCase()}`, 494, 160); }
    else if (ctrl.editPiece) { g.fillStyle = '#7ec8ff'; g.fillText('EDIT', 494, 160); }
    else if (cur && cur.kind === 'weapon') {
      g.fillStyle = RARITIES[cur.rarity].color; g.fillText(`${cur.mag}`, 400, 160);
      g.font = 'bold 26px sans-serif'; g.fillStyle = '#c8d2e8'; g.fillText(`/ ${p.inv.ammo[WEAPONS[cur.type].ammo]}`, 494, 162);
    } else if (cur && cur.kind === 'consumable') { g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.fillText(`${CONSUMABLES[cur.type].name} x${cur.count}`, 494, 160); }
    else if (p.inv.sel === 0) { g.fillStyle = '#cfd8e2'; g.font = 'bold 30px sans-serif'; g.fillText('Pickaxe', 494, 160); }
    // materials
    g.font = 'bold 22px sans-serif'; g.textAlign = 'left';
    const mats = [['wood', '#c08a4a'], ['brick', '#d06a4a'], ['metal', '#a8b4c4']];
    mats.forEach(([k, c], i) => {
      const x = 16 + i * 66, sel = ctrl.buildMode && ctrl.material === k;
      g.fillStyle = sel ? '#ffd23f' : c; g.fillRect(x, 212, 14, 14);
      g.fillStyle = sel ? '#ffd23f' : '#e8eefc'; g.fillText(String(p.inv.mats[k]), x + 18, 220);
    });
    // hotbar (icons from the 2D HUD)
    for (let i = 0; i < 6; i++) {
      const el = hud.slotEls && hud.slotEls[i];
      const x = 214 + i * 47, y = 188;
      const sel = el && el.classList.contains('sel');
      g.fillStyle = sel ? 'rgba(255,210,63,0.9)' : 'rgba(255,255,255,0.12)';
      roundRect(g, x, y, 42, 42, 8); g.fill();
      const img = el && el.querySelector('img');
      if (img && img.complete && img.naturalWidth && img.style.visibility !== 'hidden') { try { g.drawImage(img, x + 3, y + 3, 36, 36); } catch { /* ignore */ } }
    }
    // storm + kill feed
    g.font = '21px sans-serif'; g.fillStyle = '#d7c2ff'; g.textAlign = 'left';
    g.fillText(hud.el.stormText.textContent.slice(0, 44), 16, 262);
    g.fillStyle = '#c8d2e8'; g.font = '19px sans-serif';
    this.kills.forEach((k, i) => g.fillText(k.text.slice(0, 48), 16, 296 + i * 26));
    // progress (reload / heal)
    let prog = null;
    if (p.reloadT > 0) prog = 1 - p.reloadT / p.reloadTotal;
    else if (p.useT > 0) prog = 1 - p.useT / p.useTotal;
    if (prog !== null) { g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(16, 366, 480, 8); g.fillStyle = '#ffd23f'; g.fillRect(16, 366, 480 * prog, 8); }
    this.wrist.tex.needsUpdate = true;
  }

  drawStrip() {
    const m = this.match, p = m.player, ctrl = m.controller, g = this.strip.g;
    const W = 1024, H = 256;
    g.clearRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = [];
    if (this.center) lines.push({ text: this.center.text, font: 'bold 54px sans-serif', color: '#ffd23f' }, ...(this.center.sub ? [{ text: this.center.sub, font: '32px sans-serif', color: '#fff' }] : []));
    let info = '';
    if (m.phase === 'bus' && p.mode === 'bus') info = m.bus.canJump ? 'Press A to jump from the bus' : 'Doors opening...';
    else if (p.mode === 'freefall') info = `ALT ${Math.max(0, p.pos.y - Math.max(0, m.world.hm.height(p.pos.x, p.pos.z))).toFixed(0)} m · A = glider · look down + stick forward to dive`;
    else if (p.mode === 'glide') info = `ALT ${Math.max(0, p.pos.y - Math.max(0, m.world.hm.height(p.pos.x, p.pos.z))).toFixed(0)} m · stick forward / back = speed`;
    if (info) lines.push({ text: info, font: 'bold 32px sans-serif', color: '#bfe6ff' });
    if (!p.alive && m.phase !== 'over') {
      const t = m.spectateTarget;
      lines.push({ text: t ? `SPECTATING ${t.name}${t.persona ? ' · ' + t.persona.name : ''} · ${t.stats.kills} elims` : 'ELIMINATED', font: 'bold 34px sans-serif', color: '#ffd23f' });
      lines.push({ text: 'Trigger / A: next player · Y: menu (leave match)', font: '28px sans-serif', color: '#e8eefc' });
    }
    if (p.alive && ctrl.prompt) lines.push({ text: 'GRIP: ' + ctrl.prompt.text, font: 'bold 34px sans-serif', color: ctrl.prompt.color });
    for (const t of this.toasts) lines.push({ text: t.text, font: 'bold 30px sans-serif', color: t.color });
    const shown = lines.slice(0, 5);
    if (shown.length) {
      g.fillStyle = 'rgba(8,12,24,0.45)'; roundRect(g, 40, 0, W - 80, Math.min(H, 20 + shown.length * 48), 24); g.fill();
    }
    shown.forEach((l, i) => {
      g.font = l.font; g.fillStyle = l.color;
      g.fillText(l.text.slice(0, 64), W / 2, 34 + i * 48);
    });
    this.strip.tex.needsUpdate = true;
  }

  drawRing() {
    const m = this.match, hud = m.hud, p = m.player, g = this.ring.g;
    const dirs = hud.dirs;
    if (!dirs.length && !this.ringDrawn) return;
    g.clearRect(0, 0, 256, 256);
    const yaw = this.xr.rigYaw + this.xr.headYaw;
    for (const d of dirs) {
      const ang = Math.atan2(d.x - p.pos.x, -(d.z - p.pos.z)) + yaw;
      g.save(); g.translate(128, 128); g.rotate(ang);
      g.strokeStyle = `rgba(255,60,50,${Math.min(1, d.life)})`; g.lineWidth = 9; g.lineCap = 'round';
      g.beginPath(); g.arc(0, 0, 110, -Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3); g.stroke();
      g.restore();
    }
    this.ringDrawn = dirs.length > 0;
    this.ring.tex.needsUpdate = true;
  }
}
