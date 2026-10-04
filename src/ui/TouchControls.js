// On-screen controls for phones / tablets (iOS Safari, Android Chrome). Uses Pointer Events, so it
// also works with a mouse for testing (?touch=1).
//  - left side: floating joystick (push to the rim = sprint)
//  - right side: drag anywhere to look; the FIRE button can be dragged to aim while shooting
//  - buttons: fire, aim (toggle ADS / build: material), jump, crouch (toggle), reload (build: rotate),
//    interact, build, edit, map, pause. Hotbar slots are tappable (HUD).
//  - optional second FIRE on the left (above the joystick): shoot with the left thumb while the right
//    thumb keeps aiming; both FIRE buttons can be held at once.

const BUTTONS = [
  ['fire', '🔫', 'FIRE'], ['fire2', '🔫', 'FIRE'], ['aim', '◎', 'AIM'], ['jump', '⤒', 'JUMP'], ['crouch', '⤓', 'CROUCH'],
  ['reload', '⟳', 'RELOAD'], ['interact', '✋', 'USE'], ['build', '▦', 'BUILD'], ['edit', '✎', 'EDIT'],
  ['map', '🗺', 'MAP'], ['pause', '⏸', 'MENU'],
];
const JOY_R = 56;

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    const root = document.createElement('div');
    root.id = 'touch';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="tc-joy hidden"><div class="tc-knob"></div></div>
      ${BUTTONS.map(([a, icon, label]) => `<div class="tc-btn tc-${a}" data-act="${a}"><span class="tc-ico">${icon}</span><span class="tc-lbl">${label}</span></div>`).join('')}
      <div class="tc-rotate hidden"><div>↻</div>Rotate your device to landscape</div>`;
    game.uiRoot.appendChild(root);
    this.root = root;
    this.joyEl = root.querySelector('.tc-joy');
    this.knob = root.querySelector('.tc-knob');
    this.btn = {};
    root.querySelectorAll('.tc-btn').forEach((b) => { this.btn[b.dataset.act] = b; });
    this.pointers = new Map(); // pointerId -> {role, x, y, ox, oy, act}
    this.adsOn = false;
    this.crouchOn = false;
    this.visible = false;
    this.fireHeld = new Set(); // pointer ids holding either FIRE button
    const opts = { passive: false };
    root.addEventListener('pointerdown', (e) => this.down(e), opts);
    root.addEventListener('pointermove', (e) => this.move(e), opts);
    root.addEventListener('pointerup', (e) => this.up(e), opts);
    root.addEventListener('pointercancel', (e) => this.up(e), opts);
    root.addEventListener('lostpointercapture', (e) => this.up(e), opts);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS: block pinch-zoom / double-tap zoom gestures over the game
    document.addEventListener('gesturestart', (e) => e.preventDefault(), opts);
    document.addEventListener('dblclick', (e) => { if (this.visible) e.preventDefault(); }, opts);
  }

  setVisible(on) {
    on = on && this.input.touchMode;
    if (on === this.visible) return;
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) this.reset();
  }

  reset() {
    for (const [, p] of this.pointers) this.endPointer(p);
    this.pointers.clear();
    this.input.axis.x = 0; this.input.axis.y = 0; this.input.axis.sprint = false;
    this.input.mouseDown[0] = false; this.input.mouseDown[2] = false;
    this.fireHeld.clear();
    this.input.virt.clear();
    this.adsOn = false; this.crouchOn = false;
    this.joyEl.classList.add('hidden');
  }

  sens() { return 1.7 * (this.game.settings.get('touchSensitivity') || 1); }

  down(e) {
    e.preventDefault();
    this.game.audio.unlock();
    const t = e.target.closest('.tc-btn');
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, role: 'look', act: null };
    if (t) {
      p.role = 'button';
      p.act = t.dataset.act;
      t.classList.add('on');
      this.pressButton(p.act, p.id);
    } else if (e.clientX < window.innerWidth * 0.42 && e.clientY > window.innerHeight * 0.3) {
      p.role = 'joy';
      this.joyEl.classList.remove('hidden');
      this.joyEl.style.left = (e.clientX - JOY_R) + 'px';
      this.joyEl.style.top = (e.clientY - JOY_R) + 'px';
      this.knob.style.transform = 'translate(0px, 0px)';
    }
    this.pointers.set(e.pointerId, p);
    try { this.root.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (p.role === 'joy') {
      let jx = e.clientX - p.ox, jy = e.clientY - p.oy;
      const l = Math.hypot(jx, jy);
      if (l > JOY_R) { jx = jx / l * JOY_R; jy = jy / l * JOY_R; }
      this.knob.style.transform = `translate(${jx}px, ${jy}px)`;
      const ax = jx / JOY_R, ay = -jy / JOY_R;
      const dead = 0.12;
      const len = Math.hypot(ax, ay);
      this.input.axis.x = len < dead ? 0 : ax;
      this.input.axis.y = len < dead ? 0 : ay;
      this.input.axis.sprint = l > JOY_R * 0.95 && ay > 0.5;
    } else if (p.role === 'look' || (p.role === 'button' && (p.act === 'fire' || p.act === 'fire2' || p.act === 'aim'))) {
      const k = this.sens();
      this.input.dx += dx * k;
      this.input.dy += dy * k;
    }
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.endPointer(p);
  }

  endPointer(p) {
    if (p.role === 'joy') {
      this.joyEl.classList.add('hidden');
      this.input.axis.x = 0; this.input.axis.y = 0; this.input.axis.sprint = false;
    } else if (p.role === 'button') {
      const b = this.btn[p.act];
      if (b && p.act !== 'crouch' && !(p.act === 'aim' && this.adsOn)) b.classList.remove('on');
      this.releaseButton(p.act, p.id);
    }
  }

  pressButton(act, pid) {
    const inp = this.input, g = this.game, m = g.match;
    const building = m && (m.controller.buildMode || m.controller.editPiece);
    switch (act) {
      case 'fire': case 'fire2':
        if (!this.fireHeld.size) inp.mousePressed[0] = true;
        this.fireHeld.add(pid); inp.mouseDown[0] = true;
        break;
      case 'aim':
        if (building) { inp.mousePressed[2] = true; break; }  // switch material
        this.adsOn = !this.adsOn;
        inp.mouseDown[2] = this.adsOn;
        this.btn.aim.classList.toggle('on', this.adsOn);
        break;
      case 'jump': inp.press('jump'); break;
      case 'crouch':
        this.crouchOn = !this.crouchOn;
        if (this.crouchOn) inp.virt.add('crouch'); else inp.virt.delete('crouch');
        this.btn.crouch.classList.toggle('on', this.crouchOn);
        break;
      case 'reload': inp.tap('reload'); inp.tap('rotate'); break;
      case 'interact': inp.tap('interact'); break;
      case 'build': inp.tap('build'); break;
      case 'edit': inp.tap('edit'); break;
      case 'map': if (m) m.toggleMap(); break;
      case 'pause': if (m) g.setPaused(true); break;
    }
  }

  releaseButton(act, pid) {
    const inp = this.input;
    if (act === 'fire' || act === 'fire2') {
      this.fireHeld.delete(pid);
      if (!this.fireHeld.size) { inp.mouseDown[0] = false; inp.mouseReleased[0] = true; }
    }
    if (act === 'jump') inp.release('jump');
  }

  /** Per-frame: context-sensitive button visibility / labels. */
  update() {
    if (!this.visible) return;
    const m = this.game.match;
    if (!m) return;
    const P = m.player, c = m.controller;
    const ground = P.alive && P.mode === 'ground';
    const building = c.buildMode || !!c.editPiece;
    const show = (a, on) => this.btn[a].classList.toggle('hidden', !on);
    show('fire', ground);
    show('fire2', ground && !!this.game.settings.get('touchLeftFire'));
    show('aim', ground);
    show('crouch', ground);
    show('reload', ground);
    show('build', ground);
    show('edit', ground);
    show('interact', ground && !!c.prompt);
    show('jump', P.alive);
    show('map', true);
    const cur = P.inv.current();
    const fireLbl = building ? (c.editPiece ? 'EDIT' : 'PLACE') : !cur ? 'SWING' : cur.kind === 'consumable' ? 'USE' : 'FIRE';
    this.setLabel('fire', fireLbl);
    this.setLabel('fire2', fireLbl);
    this.setLabel('aim', building ? 'MATERIAL' : 'AIM');
    this.setLabel('reload', building ? 'ROTATE' : 'RELOAD');
    this.setLabel('build', building ? 'COMBAT' : 'BUILD');
    this.setLabel('jump', P.mode === 'bus' ? 'DROP' : P.mode === 'freefall' ? 'GLIDER' : 'JUMP');
    if (building && this.adsOn) { this.adsOn = false; this.input.mouseDown[2] = false; this.btn.aim.classList.remove('on'); }
    if (!ground && this.crouchOn) { this.crouchOn = false; this.input.virt.delete('crouch'); this.btn.crouch.classList.remove('on'); }
    const portrait = window.innerHeight > window.innerWidth * 1.05;
    this.root.querySelector('.tc-rotate').classList.toggle('hidden', !portrait);
  }

  setLabel(a, text) {
    const el = this.btn[a].querySelector('.tc-lbl');
    if (el.textContent !== text) el.textContent = text;
  }
}
