// Controller button hints for players who don't know the Touch controller layout: a small legend card
// next to each controller (what every button does right now — it changes in build mode, while
// skydiving, spectating...), plus letter badges floating over the A/B/X/Y buttons. Shown when you
// raise a controller in front of your face, always during the first seconds of a match, or permanently
// (Settings → VR controller hints).
import * as THREE from 'three';
import { roundRect } from './XRPanel.js';

const CW = 512, CH = 420;
// approximate button spots in grip space (Quest Touch / Touch Plus); x is mirrored for the left hand
const BADGES = [{ k: 'b1', x: 0.012, y: 0.028, z: -0.045 }, { k: 'b2', x: -0.004, y: 0.032, z: -0.064 }];

/** What each button does in the current game situation (pure, also used for the pause-menu list). */
export function hintRows(main, ctx) {
  const { mode, alive, building, editing, phase, paused, teleport, smoothTurn, item } = ctx;
  if (paused) return main ? [['TRIGGER', 'Click menu buttons']] : [['TRIGGER', 'Click menu buttons'], ['Y', 'Close menu']];
  if (!alive) return main ? [['TRIGGER / A', 'Next player'], ['', 'Camera follows the player']] : [['Y', 'Menu · leave match']];
  if (main) {
    if (mode === 'bus') return [['A', 'Jump out of the bus'], ['STICK ← →', smoothTurn ? 'Turn' : 'Snap turn']];
    if (mode === 'freefall') return [['A', 'Open glider'], ['STICK ← →', 'Turn']];
    if (mode === 'glide') return [['STICK ← →', 'Turn'], ['', 'Land to start looting']];
    if (building) return [['TRIGGER', 'Place piece'], ['STICK ↑ ↓', 'Next piece'], ['STICK ← →', 'Turn'], ['B', 'Rotate stairs'], ['STICK CLICK', 'Edit piece'], ['A', 'Jump']];
    if (editing) return [['TRIGGER', 'Toggle tile'], ['B', 'Reset edit'], ['STICK CLICK', 'Finish edit'], ['A', 'Jump']];
    const fire = item === 'pickaxe' ? 'Swing (or swing your arm)' : item === 'grenade' ? 'Hold, throw & release' : item === 'heal' ? 'Use item' : 'Fire';
    return [['TRIGGER', fire], ['GRIP', 'Grab loot / open chest'], ['A', 'Jump'], ['B', 'Reload'], ['STICK ↑ ↓', 'Switch weapon'], ['STICK ← →', smoothTurn ? 'Turn' : 'Snap turn'], ['STICK CLICK', 'Crouch']];
  }
  if (mode === 'bus') return [['GRIP (hold)', 'Big map'], ['Y', 'Menu']];
  if (mode === 'freefall') return [['STICK', 'Steer · forward + look down = dive'], ['GRIP (hold)', 'Big map'], ['Y', 'Menu']];
  if (mode === 'glide') return [['STICK', 'Steer · back = slow down'], ['GRIP (hold)', 'Big map'], ['Y', 'Menu']];
  const move = teleport ? 'Push forward: teleport' : 'Move · click = sprint';
  if (building) return [['STICK', move], ['TRIGGER', 'Switch material'], ['X', 'Exit build mode'], ['GRIP (hold)', 'Big map'], ['Y', 'Menu']];
  return [['STICK', move], ['TRIGGER', 'Aim down sights'], ['X', 'Build mode'], ['GRIP (hold)', 'Big map'], ['Y', 'Menu'], ['WRIST', 'Health · ammo · map']];
}

/** hintRows names the main hand's face buttons A/B and the other hand's X/Y; swap to the physical letters. */
export function relabel(rows, isMain, letters) {
  const [p1, p2] = isMain ? ['A', 'B'] : ['X', 'Y'];
  if (p1 === letters[0]) return rows;
  const swap = { [p1]: letters[0], [p2]: letters[1] };
  return rows.map(([b, w]) => [b.split(' ').map((t) => swap[t] || t).join(' '), w]);
}

export class XRHints {
  constructor(xr) {
    this.xr = xr;
    this.cards = xr.slots.map((s) => this.makeCard(s));
    this.t = 0;
    this.introT = 0;
  }

  makeCard(slot) {
    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.123), mat);
    mesh.renderOrder = 996;
    const root = new THREE.Group();
    root.add(mesh);
    root.visible = false;
    slot.grip.add(root);
    // letter badges over the face buttons
    const badges = BADGES.map(() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.022), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
      m.renderOrder = 997;
      root.add(m);
      return { mesh: m, canvas: c, tex: t, letter: '' };
    });
    return { slot, canvas, g: canvas.getContext('2d'), tex, mesh, root, badges, alpha: 0, key: '', side: 0 };
  }

  dispose() {
    for (const c of this.cards) {
      c.root.removeFromParent();
      c.tex.dispose(); c.mesh.geometry.dispose(); c.mesh.material.dispose();
      for (const b of c.badges) { b.tex.dispose(); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    }
  }

  /** ctx: game situation (see hintRows); mainSlot: the dominant-hand slot. */
  update(dt, ctx, mainSlot, setting) {
    const xr = this.xr;
    this.introT += dt;
    const head = xr.headLocal, hy = xr.headYaw, hp = xr.headPitch;
    const fx = -Math.sin(hy) * Math.cos(hp), fy = Math.sin(hp), fz = -Math.cos(hy) * Math.cos(hp);
    for (const c of this.cards) {
      const s = c.slot;
      let want = 0;
      if (s.connected && !s.isHand && setting !== 'off') {
        if (setting === 'always' || this.introT < 20) want = 1;
        else {
          // raised in front of your face and looked at
          const p = s.grip.position;
          const dx = p.x - head.x, dy = p.y - head.y, dz = p.z - head.z, d = Math.hypot(dx, dy, dz);
          const cos = (dx * fx + dy * fy + dz * fz) / Math.max(1e-3, d);
          if (d < 0.6 && cos > 0.8) want = 1;
        }
      }
      c.alpha += (want - c.alpha) * Math.min(1, dt * (want ? 8 : 4));
      c.root.visible = c.alpha > 0.02;
      if (!c.root.visible) continue;
      const isMain = s === mainSlot;
      const side = s.handedness === 'left' ? -1 : 1;
      if (c.side !== side) {
        c.side = side;
        c.mesh.position.set(side * 0.13, 0.045, -0.01);
        c.mesh.rotation.set(-0.85, -side * 0.45, 0, 'YXZ');
        BADGES.forEach((b, i) => { c.badges[i].mesh.position.set(b.x * side, b.y + 0.012, b.z); c.badges[i].mesh.rotation.set(-1.2, 0, 0); });
      }
      c.mesh.material.opacity = c.alpha;
      for (const b of c.badges) b.mesh.material.opacity = c.alpha;
      // the face buttons are A/B on the right controller and X/Y on the left one, whichever hand is "main"
      const letters = side > 0 ? ['A', 'B'] : ['X', 'Y'];
      const rows = relabel(hintRows(isMain, ctx), isMain, letters);
      const key = JSON.stringify(rows) + letters.join('');
      if (key !== c.key) { c.key = key; this.draw(c, rows, isMain); c.badges.forEach((b, i) => this.drawBadge(b, letters[i])); }
    }
  }

  draw(c, rows, isMain) {
    const g = c.g;
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(10,16,30,0.88)'; roundRect(g, 4, 4, CW - 8, CH - 8, 26); g.fill();
    g.strokeStyle = isMain ? 'rgba(255,210,63,0.7)' : 'rgba(127,212,255,0.7)'; g.lineWidth = 4; g.stroke();
    g.textBaseline = 'middle';
    g.fillStyle = isMain ? '#ffd23f' : '#7fd4ff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'left';
    g.fillText(isMain ? 'GUN HAND' : 'OTHER HAND', 24, 36);
    const n = rows.length, rh = Math.min(52, (CH - 84) / Math.max(1, n));
    rows.forEach(([btn, what], i) => {
      const y = 84 + rh * i + rh / 2;
      if (btn) {
        g.font = 'bold 24px sans-serif';
        const w = Math.max(44, g.measureText(btn).width + 22);
        g.fillStyle = '#e8eefc'; roundRect(g, 20, y - 17, w, 34, 10); g.fill();
        g.fillStyle = '#10182c'; g.textAlign = 'center'; g.fillText(btn, 20 + w / 2, y + 1);
        g.fillStyle = '#ffffff'; g.font = '26px sans-serif'; g.textAlign = 'left';
        g.fillText(what, 32 + w, y + 1, CW - 52 - w);
      } else { g.fillStyle = '#c8d2e8'; g.font = 'italic 24px sans-serif'; g.textAlign = 'left'; g.fillText(what, 24, y + 1); }
    });
    c.tex.needsUpdate = true;
  }

  drawBadge(b, letter) {
    if (b.letter === letter) return;
    b.letter = letter;
    const g = b.canvas.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,210,63,0.95)'; g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#10182c'; g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, 32, 34);
    b.tex.needsUpdate = true;
  }
}
