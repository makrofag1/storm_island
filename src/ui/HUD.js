// In-match HUD: health/shield, hotbar, ammo, materials, crosshair with bloom, hit markers, damage
// numbers & direction, compass, minimap, full map, kill feed, storm info, prompts and progress bars.
import * as THREE from 'three';
import { HALF, WORLD_SIZE, RARITIES } from '../core/config.js';
import { formatTime } from '../core/math.js';
import { WEAPONS, CONSUMABLES } from '../combat/Items.js';
import { iconFor, pieceIcon, materialIcon, weaponIcon } from './Icons.js';
import { PIECES } from '../build/grid.js';

const _v = new THREE.Vector3();

export class HUD {
  constructor(match) {
    this.match = match;
    this.game = match.game;
    this.xr = null; // XRHud while playing in VR
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div class="storm-overlay"></div>
      <div class="scope-overlay hidden"><div class="scope-ring"></div></div>
      <div class="hud-tl">
        <canvas class="minimap" width="200" height="200"></canvas>
        <div class="hud-stats">
          <span class="st-alive" title="Players left">👤 <b>0</b></span>
          <span class="st-kills" title="Eliminations">☠ <b>0</b></span>
        </div>
        <div class="storm-info"><span class="storm-icon">🌀</span> <span class="storm-text"></span></div>
      </div>
      <canvas class="compass" width="420" height="34"></canvas>
      <div class="killfeed"></div>
      <div class="crosshair"><i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><i class="ch-dot"></i></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <canvas class="dmg-dir" width="300" height="300"></canvas>
      <div class="dmgnums"></div>
      <div class="prompt hidden"><kbd>E</kbd><span></span></div>
      <div class="progress hidden"><div class="progress-label"></div><div class="progress-bar"><i></i></div></div>
      <div class="center-msg"></div>
      <div class="toasts"></div>
      <div class="drop-info hidden"></div>
      <div class="bars">
        <div class="bar shield"><i></i><span>0</span></div>
        <div class="bar health"><i></i><span>100</span></div>
      </div>
      <div class="hud-br">
        <div class="mats"></div>
        <div class="ammo-box"><span class="ammo-mag"></span><span class="ammo-res"></span></div>
        <div class="hotbar"></div>
        <div class="build-hint hidden"></div>
      </div>
      <div class="spectate hidden"></div>
      <div class="bigmap hidden"><div class="bigmap-inner"><button class="bigmap-close" title="Close map">✕</button><canvas width="760" height="760"></canvas><div class="bigmap-help"></div></div></div>
    `;
    this.game.uiRoot.appendChild(root);
    this.root = root;
    const q = (s) => root.querySelector(s);
    this.el = {
      stormOverlay: q('.storm-overlay'), scope: q('.scope-overlay'), minimap: q('.minimap'), alive: q('.st-alive b'), kills: q('.st-kills b'),
      stormText: q('.storm-text'), compass: q('.compass'), killfeed: q('.killfeed'), crosshair: q('.crosshair'), hitmarker: q('.hitmarker'),
      dmgDir: q('.dmg-dir'), dmgnums: q('.dmgnums'), prompt: q('.prompt'), promptText: q('.prompt span'), progress: q('.progress'),
      progressLabel: q('.progress-label'), progressBar: q('.progress-bar i'), centerMsg: q('.center-msg'), toasts: q('.toasts'),
      dropInfo: q('.drop-info'), shield: q('.bar.shield i'), shieldTxt: q('.bar.shield span'), health: q('.bar.health i'), healthTxt: q('.bar.health span'),
      mats: q('.mats'), ammoMag: q('.ammo-mag'), ammoRes: q('.ammo-res'), hotbar: q('.hotbar'), buildHint: q('.build-hint'), spectate: q('.spectate'),
      bigmap: q('.bigmap'), bigCanvas: q('.bigmap canvas'), chT: q('.ch-t'), chB: q('.ch-b'), chL: q('.ch-l'), chR: q('.ch-r'),
    };
    this.mmCtx = this.el.minimap.getContext('2d');
    this.compassCtx = this.el.compass.getContext('2d');
    this.dirCtx = this.el.dmgDir.getContext('2d');
    this.dirs = [];
    this.pings = [];
    this.nums = [];
    this.hitT = 0;
    this.centerT = 0;
    this.cache = {};
    this.buildHotbar();
    this.mapImage = this.renderMapImage();
    this.el.bigCanvas.addEventListener('pointerdown', (e) => this.onMapClick(e));
    root.querySelector('.bigmap-close').addEventListener('click', () => this.match.toggleMap(false));
    root.querySelector('.bigmap-help').textContent = this.game.input.touchMode ? 'Tap to place a marker · tap the marker again to clear' : 'Click to place a marker · Right-click to clear · M / Tab to close';
    this.el.bigCanvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.match.marker = null; this.drawBigMap(); });
    this.el.spectate.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'next') this.match.nextSpectateTarget();
      if (b.dataset.act === 'leave') this.game.leaveMatch(true);
    });
  }

  buildHotbar() {
    const hb = this.el.hotbar;
    hb.innerHTML = '';
    this.slotEls = [];
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('div');
      d.className = 'slot';
      d.innerHTML = `<img alt=""><span class="slot-key">${i + 1}</span><span class="slot-count"></span>`;
      d.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.match.controller.selectSlot(i); });
      hb.appendChild(d);
      this.slotEls.push(d);
    }
    const mats = this.el.mats;
    mats.innerHTML = '';
    this.matEls = {};
    for (const m of ['wood', 'brick', 'metal']) {
      const d = document.createElement('div');
      d.className = 'mat';
      d.innerHTML = `<img src="${materialIcon(m)}" alt=""><span>0</span>`;
      mats.appendChild(d);
      this.matEls[m] = d;
    }
  }

  renderMapImage() {
    const N = 512;
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const hm = this.match.world.hm;
    const col = [0, 0, 0];
    const nrm = { x: 0, y: 1, z: 0 };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -HALF + (i + 0.5) / N * WORLD_SIZE, z = -HALF + (j + 0.5) / N * WORLD_SIZE;
      const h = hm.height(x, z);
      let r, gg, b;
      if (h < 0) {
        const d = Math.min(1, -h / 14);
        r = 40 - d * 25; gg = 170 - d * 90; b = 200 - d * 60;
      } else {
        hm.normal(x, z, nrm);
        hm.colorAt(x, z, h, nrm.y, col);
        const shade = 0.75 + 0.45 * Math.max(0, nrm.x * -0.5 + nrm.y * 0.6 + nrm.z * -0.5);
        r = col[0] * 255 * shade; gg = col[1] * 255 * shade; b = col[2] * 255 * shade;
      }
      const k = (j * N + i) * 4;
      img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // buildings
    const s = N / WORLD_SIZE;
    for (const bl of this.match.world.buildings) {
      g.fillStyle = 'rgba(70,60,60,0.85)';
      g.fillRect((bl.minX + HALF) * s, (bl.minZ + HALF) * s, Math.max(1.5, (bl.maxX - bl.minX) * s), Math.max(1.5, (bl.maxZ - bl.minZ) * s));
    }
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.13)';
    g.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      g.beginPath(); g.moveTo(i * N / 8, 0); g.lineTo(i * N / 8, N); g.stroke();
      g.beginPath(); g.moveTo(0, i * N / 8); g.lineTo(N, i * N / 8); g.stroke();
    }
    return c;
  }

  toast(text, color = '#fff') {
    if (this.xr) this.xr.toast(text, color); // VR HUD mirror
    const d = document.createElement('div');
    d.className = 'toast';
    d.style.color = color;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 1800);
    setTimeout(() => d.remove(), 2400);
  }

  centerMessage(text, sub = '', dur = 3, cls = '') {
    if (this.xr) this.xr.centerMessage(text, sub, dur);
    this.el.centerMsg.innerHTML = `<div class="cm-main ${cls}">${text}</div>${sub ? `<div class="cm-sub">${sub}</div>` : ''}`;
    this.el.centerMsg.classList.add('show');
    this.centerT = dur;
  }

  killfeed(html, highlight = false) {
    if (this.xr) this.xr.killfeed(html);
    const d = document.createElement('div');
    d.className = 'kf' + (highlight ? ' kf-me' : '');
    d.innerHTML = html;
    this.el.killfeed.prepend(d);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), 6000);
    setTimeout(() => d.remove(), 7000);
  }

  hitmarker(head, kill) {
    const hm = this.el.hitmarker;
    hm.className = 'hitmarker show' + (head ? ' head' : '') + (kill ? ' kill' : '');
    this.hitT = 0.18;
  }

  damageNumber(x, y, z, amount, head, shield) {
    let n = this.nums.find((q) => q.life <= 0);
    if (!n) {
      if (this.nums.length > 40) return;
      const el = document.createElement('div');
      el.className = 'dmgnum';
      this.el.dmgnums.appendChild(el);
      n = { el, life: 0 };
      this.nums.push(n);
    }
    n.x = x + (Math.random() - 0.5) * 0.4; n.y = y + 0.4; n.z = z + (Math.random() - 0.5) * 0.4;
    n.life = 0.9; n.vy = 1.6;
    n.el.textContent = Math.round(amount);
    n.el.className = 'dmgnum' + (head ? ' head' : '') + (shield ? ' shield' : '');
    n.el.style.display = 'block';
  }

  damageFrom(x, z) { this.dirs.push({ x, z, life: 1.2 }); }
  ping(x, z) { this.pings.push({ x, z, life: 3 }); if (this.pings.length > 30) this.pings.shift(); }

  showMap(open) {
    this.el.bigmap.classList.toggle('hidden', !open);
    if (open) this.drawBigMap();
  }

  onMapClick(e) {
    if (e.button !== 0) return;
    const r = this.el.bigCanvas.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    const mk = { x: -HALF + u * WORLD_SIZE, z: -HALF + v * WORLD_SIZE };
    const old = this.match.marker;
    // tapping the existing marker clears it (touch has no right-click)
    this.match.marker = old && Math.hypot(old.x - mk.x, old.z - mk.z) < 25 ? null : mk;
    if (!this.match.marker) { this.drawBigMap(); return; }
    if (this.match.debugTools && this.match.debugTools.teleportOnClick) this.match.debugTools.teleport(this.match.marker.x, this.match.marker.z);
    this.drawBigMap();
  }

  drawBigMap() {
    const c = this.el.bigCanvas, g = c.getContext('2d');
    const W = c.width, s = W / WORLD_SIZE;
    const m = this.match;
    g.clearRect(0, 0, W, W);
    g.drawImage(this.mapImage, 0, 0, W, W);
    const tx = (x) => (x + HALF) * s, tz = (z) => (z + HALF) * s;
    // storm
    const st = m.storm;
    g.save();
    g.fillStyle = 'rgba(110,40,190,0.38)';
    g.beginPath(); g.rect(0, 0, W, W); g.arc(tx(st.cur.x), tz(st.cur.z), Math.max(0, st.cur.r * s), 0, Math.PI * 2, true); g.fill('evenodd');
    g.restore();
    g.lineWidth = 2.5;
    g.strokeStyle = '#ffffff'; g.beginPath(); g.arc(tx(st.cur.x), tz(st.cur.z), Math.max(0, st.cur.r * s), 0, Math.PI * 2); g.stroke();
    if (st.state !== 'done') { g.strokeStyle = '#4aa8ff'; g.setLineDash([8, 6]); g.beginPath(); g.arc(tx(st.next.x), tz(st.next.z), Math.max(0, st.next.r * s), 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    // bus route
    if (m.bus && (m.phase === 'bus' || m.bus.active)) {
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3; g.setLineDash([12, 8]);
      g.beginPath(); g.moveTo(tx(m.bus.start.x), tz(m.bus.start.z)); g.lineTo(tx(m.bus.end.x), tz(m.bus.end.z)); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#2f6fd6'; g.beginPath(); g.arc(tx(m.bus.pos.x), tz(m.bus.pos.z), 7, 0, Math.PI * 2); g.fill();
    }
    // POIs
    g.font = 'bold 15px "Trebuchet MS", sans-serif'; g.textAlign = 'center';
    for (const p of m.world.pois) {
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(p.name.toUpperCase(), tx(p.x) + 1.5, tz(p.z) + 1.5);
      g.fillStyle = '#fff'; g.fillText(p.name.toUpperCase(), tx(p.x), tz(p.z));
    }
    // grid labels
    g.font = 'bold 12px sans-serif'; g.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 8; i++) { g.fillText(String.fromCharCode(65 + i), (i + 0.5) * W / 8, 14); g.fillText(String(i + 1), 10, (i + 0.5) * W / 8 + 4); }
    // marker
    if (m.marker) this.drawMarker(g, tx(m.marker.x), tz(m.marker.z), 1.3);
    // player
    const p = m.focusChar();
    if (p) this.drawArrow(g, tx(p.pos.x), tz(p.pos.z), p.yaw, 10, p.isPlayer ? '#ffe14a' : '#ff8ad8');
  }

  drawMarker(g, x, y, s = 1) {
    g.fillStyle = '#ffd23f'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - 6 * s, y - 12 * s); g.arc(x, y - 13 * s, 6 * s, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
  }

  drawArrow(g, x, y, yaw, size, color) {
    g.save(); g.translate(x, y); g.rotate(-yaw);
    g.fillStyle = color; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -size); g.lineTo(size * 0.7, size * 0.8); g.lineTo(0, size * 0.35); g.lineTo(-size * 0.7, size * 0.8); g.closePath();
    g.fill(); g.stroke(); g.restore();
  }

  drawMinimap(focusChar, yaw) {
    const g = this.mmCtx, W = 200, m = this.match;
    const focus = { x: focusChar.pos.x, z: focusChar.pos.z, isPlayer: focusChar.isPlayer };
    const scale = 0.95; // px per meter
    const ms = this.mapImage.width / WORLD_SIZE;
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1d4f7a'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2);
    g.rotate(yaw);
    const k = scale / ms;
    g.drawImage(this.mapImage, -(focus.x + HALF) * ms * k, -(focus.z + HALF) * ms * k, this.mapImage.width * k, this.mapImage.height * k);
    const wx = (x) => (x - focus.x) * scale, wz = (z) => (z - focus.z) * scale;
    const st = m.storm;
    g.fillStyle = 'rgba(110,40,190,0.4)';
    g.beginPath(); g.rect(-400, -400, 800, 800); g.arc(wx(st.cur.x), wz(st.cur.z), Math.max(0, st.cur.r * scale), 0, Math.PI * 2, true); g.fill('evenodd');
    g.lineWidth = 2;
    g.strokeStyle = '#fff'; g.beginPath(); g.arc(wx(st.cur.x), wz(st.cur.z), Math.max(0, st.cur.r * scale), 0, Math.PI * 2); g.stroke();
    if (st.state !== 'done') { g.strokeStyle = '#4aa8ff'; g.beginPath(); g.arc(wx(st.next.x), wz(st.next.z), Math.max(0, st.next.r * scale), 0, Math.PI * 2); g.stroke(); }
    if (m.bus && m.bus.active) {
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.setLineDash([6, 5]);
      g.beginPath(); g.moveTo(wx(m.bus.start.x), wz(m.bus.start.z)); g.lineTo(wx(m.bus.end.x), wz(m.bus.end.z)); g.stroke(); g.setLineDash([]);
    }
    g.font = 'bold 10px sans-serif'; g.textAlign = 'center';
    for (const p of m.world.pois) {
      const px = wx(p.x), pz = wz(p.z);
      if (Math.abs(px) > 160 || Math.abs(pz) > 160) continue;
      g.save(); g.translate(px, pz); g.rotate(-yaw);
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(p.name, 1, 1); g.fillStyle = '#fff'; g.fillText(p.name, 0, 0);
      g.restore();
    }
    for (const pg of this.pings) {
      g.fillStyle = `rgba(255,70,60,${Math.min(1, pg.life)})`;
      g.beginPath(); g.arc(wx(pg.x), wz(pg.z), 4, 0, Math.PI * 2); g.fill();
    }
    if (m.marker) { g.save(); g.translate(wx(m.marker.x), wz(m.marker.z)); g.rotate(-yaw); this.drawMarker(g, 0, 0, 0.8); g.restore(); }
    g.restore();
    // player arrow (always up)
    this.drawArrow(g, W / 2, W / 2, 0, 8, focus.isPlayer ? '#ffe14a' : '#ff8ad8');
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 3;
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); g.stroke();
    // N indicator
    const na = yaw;
    g.fillStyle = '#ffe14a'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
    g.fillText('N', W / 2 + Math.sin(na) * (W / 2 - 12), W / 2 - Math.cos(na) * (W / 2 - 12) + 5);
  }

  drawCompass(yaw) {
    const g = this.compassCtx, W = 420, H = 34;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, W, H);
    // heading in degrees: 0 = north (-Z), clockwise
    const heading = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const pxPerDeg = 3;
    g.textAlign = 'center';
    for (let d = Math.floor(heading - 75); d <= heading + 75; d++) {
      const dd = ((d % 360) + 360) % 360;
      const x = W / 2 + (d - heading) * pxPerDeg;
      if (dd % 15 === 0) {
        const label = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[dd];
        if (label) { g.fillStyle = label.length === 1 ? '#ffe14a' : '#fff'; g.font = 'bold 15px sans-serif'; g.fillText(label, x, 22); }
        else { g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = '11px sans-serif'; g.fillText(String(dd), x, 20); }
        g.fillStyle = '#fff'; g.fillRect(x - 0.5, 27, 1, 6);
      }
    }
    const m = this.match;
    const f = m.focusChar();
    if (m.marker && f) {
      const ang = Math.atan2(m.marker.x - f.pos.x, -(m.marker.z - f.pos.z)) * 180 / Math.PI;
      let rel = ((ang - heading + 540) % 360) - 180;
      rel = Math.max(-70, Math.min(70, rel));
      this.drawMarker(g, W / 2 + rel * pxPerDeg, 30, 0.7);
    }
    g.fillStyle = '#ffe14a'; g.beginPath(); g.moveTo(W / 2 - 6, 0); g.lineTo(W / 2 + 6, 0); g.lineTo(W / 2, 7); g.fill();
  }

  setText(key, el, text) {
    if (this.cache[key] === text) return;
    this.cache[key] = text;
    el.textContent = text;
  }

  update(dt) {
    const m = this.match;
    const p = m.player;
    const focus = m.focusChar() || p;
    const ctrl = m.controller;
    const cam = this.game.camera;
    // bars
    const hp = Math.max(0, Math.ceil(focus.health)), sh = Math.max(0, Math.ceil(focus.shield));
    if (this.cache.hp !== hp) { this.cache.hp = hp; this.el.health.style.width = hp + '%'; this.el.healthTxt.textContent = hp; }
    if (this.cache.sh !== sh) { this.cache.sh = sh; this.el.shield.style.width = sh + '%'; this.el.shieldTxt.textContent = sh; }
    this.setText('alive', this.el.alive, String(m.aliveCount));
    this.setText('kills', this.el.kills, String(focus.stats.kills));
    // storm
    const st = m.storm;
    let stTxt;
    if (m.phase === 'bus' || m.phase === 'pre') stTxt = `Storm forms in ${formatTime(st.timer)}`;
    else if (st.state === 'wait') stTxt = `Phase ${st.phaseNumber}/${st.totalPhases} · shrinks in ${formatTime(st.timer)}`;
    else if (st.state === 'shrink') stTxt = `Storm shrinking · ${formatTime(st.timer)}`;
    else stTxt = 'Final circle';
    if (focus && !st.isInside(focus.pos.x, focus.pos.z)) stTxt += ' · ⚠ IN STORM';
    this.setText('storm', this.el.stormText, stTxt);
    const inStorm = focus && focus.alive && focus.mode !== 'bus' && !st.isInside(focus.pos.x, focus.pos.z);
    this.el.stormOverlay.classList.toggle('on', !!inStorm);

    // hotbar / build
    const touch = this.game.input.touchMode;
    const inv = p.inv;
    const building = ctrl.buildMode;
    this.el.buildHint.classList.toggle('hidden', !building && !ctrl.editPiece);
    if (building) this.setText('bh', this.el.buildHint, touch ? `BUILD · ${ctrl.material.toUpperCase()}` : `BUILD · ${ctrl.material.toUpperCase()} · LMB place · RMB material · R rotate · Q exit`);
    else if (ctrl.editPiece) this.setText('bh', this.el.buildHint, touch ? 'EDIT · aim at a tile + EDIT button · EDIT again (top) to finish' : 'EDIT · LMB toggle tile · R reset · G confirm');
    for (let i = 0; i < 6; i++) {
      const el = this.slotEls[i];
      let src = '', count = '', color = '', sel = false, key;
      if (building) {
        if (i < 4) { src = pieceIcon(PIECES[i]); sel = ctrl.piece === PIECES[i]; color = '#3a8fd8'; }
        key = `b${i}${sel}${building}`;
      } else if (i === 0) { src = weaponIcon('pickaxe'); sel = inv.sel === 0; color = '#6c7a86'; key = `p${sel}`; }
      else {
        const item = inv.slots[i - 1];
        sel = inv.sel === i;
        if (item) {
          src = iconFor(item);
          color = item.kind === 'weapon' ? RARITIES[item.rarity].color : '#56606a';
          count = item.kind === 'consumable' ? String(item.count) : item.kind === 'weapon' ? String(item.mag) : '';
        }
        key = `s${i}${sel}${item ? item.type + item.rarity + count : ''}`;
      }
      if (this.cache['slot' + i] !== key) {
        this.cache['slot' + i] = key;
        el.querySelector('img').src = src || 'data:,';
        el.querySelector('img').style.visibility = src ? 'visible' : 'hidden';
        el.querySelector('.slot-count').textContent = count;
        el.style.setProperty('--rc', color || 'rgba(0,0,0,0.3)');
        el.classList.toggle('sel', sel);
        el.classList.toggle('filled', !!src);
        el.querySelector('.slot-key').textContent = building ? (i < 4 ? String(i + 1) : '') : String(i + 1);
      }
    }
    for (const mm of ['wood', 'brick', 'metal']) {
      const v = inv.mats[mm];
      const k = v + (building && ctrl.material === mm ? '*' : '');
      if (this.cache['m' + mm] !== k) {
        this.cache['m' + mm] = k;
        this.matEls[mm].querySelector('span').textContent = v;
        this.matEls[mm].classList.toggle('sel', building && ctrl.material === mm);
      }
    }
    const cur = inv.current();
    if (cur && cur.kind === 'weapon' && !building) {
      const def = WEAPONS[cur.type];
      this.setText('amag', this.el.ammoMag, String(cur.mag));
      this.setText('ares', this.el.ammoRes, ' / ' + inv.ammo[def.ammo]);
    } else {
      this.setText('amag', this.el.ammoMag, '');
      this.setText('ares', this.el.ammoRes, '');
    }

    // crosshair bloom
    const ads = ctrl.adsInfo();
    const scoped = m.cameraRig.scoped;
    this.el.scope.classList.toggle('hidden', !scoped);
    let gap = 6;
    if (cur && cur.kind === 'weapon' && !building) {
      const spread = m.combat.spreadFor(p, WEAPONS[cur.type], cur, ads.ads);
      gap = 4 + Math.tan(spread) / Math.tan(cam.fov * Math.PI / 360) * (window.innerHeight / 2);
    }
    gap = Math.min(90, gap);
    if (Math.abs((this.cache.gap || 0) - gap) > 0.3) {
      this.cache.gap = gap;
      this.el.chT.style.transform = `translate(-50%, ${-gap - 10}px)`;
      this.el.chB.style.transform = `translate(-50%, ${gap}px)`;
      this.el.chL.style.transform = `translate(${-gap - 10}px, -50%)`;
      this.el.chR.style.transform = `translate(${gap}px, -50%)`;
    }
    this.el.crosshair.classList.toggle('hidden', !p.alive || p.mode !== 'ground' || scoped || m.phase === 'spectate');
    this.el.crosshair.classList.toggle('enemy', !!ctrl.aimChar);
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.el.hitmarker.className = 'hitmarker'; }

    // prompt / progress
    const pr = p.alive && ctrl.prompt;
    this.el.prompt.classList.toggle('hidden', !pr);
    if (pr) { this.setText('pr', this.el.promptText, pr.text); this.el.promptText.style.color = pr.color; }
    let prog = null;
    if (p.reloadT > 0) prog = ['Reloading', 1 - p.reloadT / p.reloadTotal];
    else if (p.useT > 0) { const it = inv.slots[p.useSlot]; prog = [it ? CONSUMABLES[it.type].name : 'Using', 1 - p.useT / p.useTotal]; }
    this.el.progress.classList.toggle('hidden', !prog);
    if (prog) { this.setText('pl', this.el.progressLabel, prog[0]); this.el.progressBar.style.width = (prog[1] * 100).toFixed(1) + '%'; }

    // drop info
    let drop = '';

    if (m.phase === 'bus' && p.mode === 'bus') drop = m.bus.canJump ? (touch ? 'Tap <kbd>DROP</kbd> to jump from the bus' : 'Press <kbd>SPACE</kbd> to jump from the bus') : 'Doors opening...';
    else if (p.mode === 'freefall' || p.mode === 'glide') {
      const alt = Math.max(0, p.pos.y - Math.max(0, m.world.hm.height(p.pos.x, p.pos.z)));
      const spd = Math.hypot(p.vel.x, p.vel.y, p.vel.z) * 3.6;
      drop = `ALT <b>${alt.toFixed(0)} m</b> · SPEED <b>${spd.toFixed(0)} km/h</b>` + (touch ? (p.mode === 'freefall' ? ' · <kbd>GLIDER</kbd> to deploy · look down + stick forward to dive' : '') : (p.mode === 'freefall' ? ' · <kbd>SPACE</kbd> deploy glider · look down + <kbd>W</kbd> dive' : ' · <kbd>W</kbd>/<kbd>S</kbd> speed'));
    }
    this.el.dropInfo.classList.toggle('hidden', !drop);
    if (drop && this.cache.drop !== drop) { this.cache.drop = drop; this.el.dropInfo.innerHTML = drop; }

    // center message timer
    if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) this.el.centerMsg.classList.remove('show'); }

    // spectate bar
    const spec = m.phase === 'spectate' || (!p.alive && m.phase !== 'over');
    this.el.spectate.classList.toggle('hidden', !spec);
    if (spec) {
      const tgt = m.spectateTarget;
      const html = `<div class="spec-title">${tgt ? `Spectating <b>${escapeHtml(tgt.name)}</b>${tgt.persona ? ` · ${tgt.persona.icon} ${tgt.persona.name}` : ''} · ${tgt.stats.kills} elims` : 'Eliminated'}</div><div class="spec-btns"><button data-act="next">Next player (Space / Click)</button><button data-act="leave">Leave match</button></div>`;
      if (this.cache.spec !== html) { this.cache.spec = html; this.el.spectate.innerHTML = html; }
    }

    // minimap + compass
    const yaw = focus === p ? p.yaw : (m.spectateYaw ?? focus.yaw);
    this.drawMinimap(focus, yaw);
    this.drawCompass(yaw);
    for (const pg of this.pings) pg.life -= dt;
    this.pings = this.pings.filter((pg) => pg.life > 0);
    if (!this.el.bigmap.classList.contains('hidden')) { this.mapT = (this.mapT || 0) + dt; if (this.mapT > 0.25) { this.mapT = 0; this.drawBigMap(); } }

    // damage direction indicators
    const dc = this.dirCtx;
    dc.clearRect(0, 0, 300, 300);
    for (const d of this.dirs) {
      d.life -= dt;
      const ang = Math.atan2(d.x - focus.pos.x, -(d.z - focus.pos.z)) + yaw; // relative to view (0 = ahead)
      dc.save(); dc.translate(150, 150); dc.rotate(ang);
      dc.strokeStyle = `rgba(255,60,50,${Math.min(1, d.life)})`; dc.lineWidth = 7; dc.lineCap = 'round';
      dc.beginPath(); dc.arc(0, 0, 120, -Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3); dc.stroke();
      dc.restore();
    }
    this.dirs = this.dirs.filter((d) => d.life > 0);

    // damage numbers
    const w = window.innerWidth, h = window.innerHeight;
    for (const n of this.nums) {
      if (n.life <= 0) continue;
      n.life -= dt;
      n.y += n.vy * dt; n.vy -= 2 * dt;
      _v.set(n.x, n.y, n.z).project(cam);
      if (n.life <= 0 || _v.z > 1) { n.el.style.display = 'none'; n.life = 0; continue; }
      n.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%,-50%) scale(${0.8 + Math.min(1, n.life) * 0.4})`;
      n.el.style.opacity = Math.min(1, n.life * 2.5);
    }
  }

  dispose() { this.root.remove(); }
}

export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
