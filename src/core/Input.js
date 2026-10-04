// Keyboard / mouse / touch input with action bindings and pointer lock.
// "pressed" edges are buffered until the next simulation tick consumes them (endTick).
//
// Modes:
//  - pointer lock (desktop default)
//  - free mouse: fallback when pointer lock is unavailable (e.g. embedded iframes) — mouse movement
//    over the canvas turns the camera, arrow keys also look around
//  - touch: on-screen controls (TouchControls) feed virtual actions, an analog move axis and look deltas

const BLOCKED = new Set(['Tab', 'Space', 'F3', 'F2', 'Backquote', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyS', 'ControlLeft']);

/**
 * Phone / tablet detection: the PRIMARY pointer must be a finger. Laptops and PCs with a touchscreen
 * report touch points too, but their primary pointer is a mouse/touchpad (fine + hover), so they get
 * desktop controls (auto mode still switches to touch the moment the screen is actually touched).
 */
export function isTouchDevice() {
  try {
    if (typeof matchMedia === 'undefined') return false;
    if (matchMedia('(pointer: coarse)').matches) return true;
    if (matchMedia('(pointer: fine)').matches || matchMedia('(hover: hover)').matches) return false;
    return (navigator.maxTouchPoints || 0) > 1;
  } catch { return false; }
}

export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.down = new Set();
    this.pressedSet = new Set();
    this.virt = new Set();          // virtual actions held (touch buttons)
    this.virtPressed = new Set();   // virtual actions pressed this tick
    this.axis = { x: 0, y: 0, sprint: false }; // analog move (touch joystick): x right, y forward
    this.mouseDown = [false, false, false];
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
    this.rawMouse = [false, false, false]; // physical buttons (VR simulator reads these; mouseDown may be driven by controllers)
    this.xrOnly = false;        // VR: game actions come only from the controllers (virtual actions)
    this.dx = 0; this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.freeMouse = false;
    this.lockFailed = false;
    this.touchMode = false;
    this.wantLook = false;      // set by the game while a match is being played
    this.captureNextKey = null; // rebind callback
    this.onLockChange = null;
    this.onLockFailed = null;
    this.onKeyRaw = null;       // UI hook for global keys (Esc, F3...)
    this.onTouchModeChange = null;
    this.onCtrlWarn = null;       // Ctrl pressed in-game while the browser could still steal Ctrl+W
    this.keyboardLocked = false;  // fullscreen + Keyboard Lock API: Ctrl+W / Ctrl+T reach the game
    this.setTouchMode(this.resolveTouchSetting());

    this._kd = (e) => this.keyDown(e);
    this._ku = (e) => this.keyUp(e);
    this._md = (e) => this.mouseDownEv(e);
    this._mu = (e) => this.mouseUpEv(e);
    this._mm = (e) => this.mouseMove(e);
    this._wh = (e) => this.wheelEv(e);
    this._plc = () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) { clearTimeout(this.lockTimer); this.lockFailures = 0; this.freeMouse = false; document.body.classList.remove('free-mouse'); }
      else this.releaseAll();
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    this._ple = () => this.failLock();
    this._blur = () => this.releaseAll();
    this._pd = (e) => { if (e.pointerType === 'touch') this.autoSwitch(true); else if (e.pointerType === 'mouse') this.autoSwitch(false); };
    window.addEventListener('pointerdown', this._pd, true);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('mousedown', this._md);
    window.addEventListener('mouseup', this._mu);
    window.addEventListener('mousemove', this._mm);
    window.addEventListener('wheel', this._wh, { passive: false });
    window.addEventListener('blur', this._blur);
    document.addEventListener('pointerlockchange', this._plc);
    document.addEventListener('pointerlockerror', this._ple);
    window.addEventListener('contextmenu', (e) => { if (this.locked || this.freeMouse || this.touchMode || e.target === canvas) e.preventDefault(); });
  }

  /** true / false when touch controls are forced (?touch=1/0 or the setting), null in auto mode. */
  touchOverride() {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('touch') : null;
    if (q === '1') return true;
    if (q === '0') return false;
    const s = this.settings.get('touchControls') || 'auto';
    if (s === 'on') return true;
    if (s === 'off') return false;
    return null;
  }
  resolveTouchSetting() {
    const o = this.touchOverride();
    return o === null ? isTouchDevice() : o;
  }
  /** Auto mode follows the device actually used: a finger on the screen -> touch, mouse / keyboard -> desktop. */
  autoSwitch(touch) {
    if (this.touchMode === touch || this.touchOverride() !== null) return;
    this.setTouchMode(touch);
    if (this.onTouchModeChange) this.onTouchModeChange(touch);
  }
  setTouchMode(on) {
    this.touchMode = !!on;
    if (typeof document !== 'undefined') document.body.classList.toggle('touch', this.touchMode);
  }

  /** Gameplay receives look/fire input in any of the three modes. */
  get active() { return this.locked || this.freeMouse || this.touchMode; }

  requestLock() {
    if (this.locked || this.touchMode) return;
    if (this.lockFailed) { this.enableFreeMouse(); return; }
    // Pointer lock needs a user gesture; calls from timers are expected to fail harmlessly.
    // If the environment can't lock at all (sandboxed iframe), fall back to free-mouse look.
    const fail = (e) => {
      if (!e) return;
      if (e.name === 'NotSupportedError') { this.plainLock(); return; }
      if (e.name === 'WrongDocumentError' || /sandbox/i.test(e.message || '')) this.failLock();
      else this.softFail(); // e.g. re-lock within ~1 s after Esc — only give up after repeated failures
    };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(fail);
    } catch (e) {
      this.plainLock();
    }
    clearTimeout(this.lockTimer);
    if (navigator.userActivation && navigator.userActivation.isActive) {
      // with a real user gesture the lock should arrive quickly; if not, the environment blocks it
      this.lockTimer = setTimeout(() => { if (!this.locked) this.softFail(); }, 900);
    }
  }
  plainLock() {
    try { const p2 = this.canvas.requestPointerLock(); if (p2 && p2.catch) p2.catch((e) => { if (e && e.name !== 'NotSupportedError') this.failLock(); }); } catch { this.failLock(); }
  }
  softFail() {
    this.lockFailures = (this.lockFailures || 0) + 1;
    if (this.lockFailures >= 2) this.failLock();
  }
  failLock() {
    if (this.locked || this.touchMode) return;
    this.lockFailed = true;
    this.enableFreeMouse();
  }
  enableFreeMouse() {
    if (this.freeMouse) return;
    this.freeMouse = true;
    document.body.classList.add('free-mouse');
    if (this.onLockFailed) this.onLockFailed();
  }
  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  keyDown(e) {
    if (this.captureNextKey) {
      e.preventDefault();
      const cb = this.captureNextKey; this.captureNextKey = null;
      cb(e.code);
      return;
    }
    if (this.onKeyRaw && this.onKeyRaw(e)) { e.preventDefault(); return; }
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (this.touchMode && Object.values(this.settings.data.keys).includes(e.code)) this.autoSwitch(false);
    if ((e.code === 'ControlLeft' || e.code === 'ControlRight') && this.wantLook && !this.keyboardLocked && this.onCtrlWarn) this.onCtrlWarn();
    // keyboard locked (fullscreen): browser shortcuts like Ctrl+W / Ctrl+T / Ctrl+N must not fire
    if (this.keyboardLocked && (e.ctrlKey || e.metaKey) && this.wantLook) e.preventDefault();
    if ((this.locked || (this.freeMouse && this.wantLook)) && (BLOCKED.has(e.code) || e.code.startsWith('Digit') || e.code.startsWith('F'))) e.preventDefault();
    if (e.code === 'Tab') e.preventDefault();
    if (!this.down.has(e.code)) this.pressedSet.add(e.code);
    this.down.add(e.code);
  }
  keyUp(e) { this.down.delete(e.code); }
  mouseDownEv(e) {
    const ok = this.locked || (this.freeMouse && this.wantLook && e.target === this.canvas);
    if (!ok) return;
    if (e.button < 3) { this.mouseDown[e.button] = true; this.mousePressed[e.button] = true; this.rawMouse[e.button] = true; }
  }
  mouseUpEv(e) {
    if (e.button < 3) this.rawMouse[e.button] = false;
    if (e.button < 3) { if (this.mouseDown[e.button]) this.mouseReleased[e.button] = true; this.mouseDown[e.button] = false; }
  }
  mouseMove(e) {
    if (this.freeMouse) { this.mx = e.clientX; this.my = e.clientY; this.overCanvas = e.target === this.canvas; }
    const ok = this.locked || (this.freeMouse && this.wantLook && e.target === this.canvas);
    if (!ok) return;
    // Guard against occasional huge spikes some browsers emit on lock.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.dx += e.movementX; this.dy += e.movementY;
  }
  wheelEv(e) {
    if (!(this.locked || (this.freeMouse && this.wantLook))) return;
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  }
  releaseAll() {
    this.down.clear();
    this.mouseDown = [false, false, false];
    this.rawMouse = [false, false, false];
  }

  key(action) {
    if (this.virt.has(action)) return true;
    if (this.xrOnly) return false;
    const code = this.settings.data.keys[action];
    // Ctrl only crouches when the keyboard is locked (fullscreen): otherwise Ctrl+W (crouch + forward)
    // closes the browser tab and no web page can stop that
    if (action === 'crouch' && this.keyboardLocked && (this.down.has('ControlLeft') || this.down.has('ControlRight'))) return true;
    return code ? this.down.has(code) : false;
  }
  pressed(action) {
    if (this.virtPressed.has(action)) return true;
    if (this.xrOnly) return false;
    const code = this.settings.data.keys[action];
    return code ? this.pressedSet.has(code) : false;
  }
  pressedCode(code) { return this.pressedSet.has(code); }
  /** Virtual (touch) press: held until release(), plus a one-tick "pressed" edge. */
  press(action) { this.virt.add(action); this.virtPressed.add(action); }
  release(action) { this.virt.delete(action); }
  tap(action) { this.virtPressed.add(action); }

  /** Mouse delta for camera look, including arrow-key look (useful without pointer lock). */
  consumeMouse(dt = 0.016) {
    let dx = this.dx, dy = this.dy;
    this.dx = 0; this.dy = 0;
    if (this.wantLook && this.freeMouse && this.overCanvas && this.mx !== undefined) {
      // free-mouse mode: keep turning while the cursor rests near the left/right edge
      const w = window.innerWidth, edge = w * 0.06;
      if (this.mx < edge) dx -= 700 * dt * (1 - this.mx / edge);
      else if (this.mx > w - edge) dx += 700 * dt * (1 - (w - this.mx) / edge);
    }
    if (this.wantLook) {
      const k = 900 * dt;
      if (this.down.has('ArrowLeft')) dx -= k;
      if (this.down.has('ArrowRight')) dx += k;
      if (this.down.has('ArrowUp')) dy -= k * 0.6;
      if (this.down.has('ArrowDown')) dy += k * 0.6;
    }
    return [dx, dy];
  }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
  endTick() {
    this.pressedSet.clear();
    this.virtPressed.clear();
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
  }
  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    window.removeEventListener('mousedown', this._md);
    window.removeEventListener('mouseup', this._mu);
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('wheel', this._wh);
    window.removeEventListener('pointerdown', this._pd, true);
    document.removeEventListener('pointerlockchange', this._plc);
    document.removeEventListener('pointerlockerror', this._ple);
  }
}
