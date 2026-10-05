// Top level game: renderer, main loop (fixed 60 Hz simulation + interpolated rendering) and the
// state machine Menu -> Lobby -> SkyBus -> InMatch -> Spectate/Eliminated -> Results -> Menu.
import * as THREE from 'three';
import { Settings } from './Settings.js';
import { Input } from './Input.js';
import { EventBus } from './EventBus.js';
import { resolveSeed } from './rng.js';
import { QUALITY, DT, DEBUG } from './config.js';
import { Match } from '../match/Match.js';
import { Menus } from '../ui/Menus.js';
import { AudioEngine } from '../audio/Audio.js';
import { DebugOverlay } from '../debug/DebugOverlay.js';
import { CONTEXT_ATTRIBUTES, detectGPU } from './gpu.js';
import { TouchControls } from '../ui/TouchControls.js';
import { MAP_OPTIONS } from '../world/MapOptions.js';
import { XRManager } from '../xr/XRManager.js';
import { XRPanel } from '../xr/XRPanel.js';
import { formatTime } from './math.js';

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.settings = new Settings();
    this.events = new EventBus();
    this.input = new Input(canvas, this.settings);
    this.state = 'menu';
    this.paused = false;
    this.match = null;
    this.debugMode = DEBUG;

    const qName = this.settings.get('quality');
    this.quality = QUALITY[qName] || QUALITY.medium;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: qName === 'high', ...CONTEXT_ATTRIBUTES });
    this.gpu = detectGPU(this.renderer.getContext());
    console.info(`[Storm Island] GPU: ${this.gpu.name} (${this.gpu.kind}) — raw: ${this.gpu.raw}`);
    canvas.addEventListener('webglcontextlost', (e) => {
      // e.g. GPU switch / driver reset: keep the page alive and let the browser restore the context
      e.preventDefault();
      this.contextLost = true;
      if (this.match && this.isPlaying()) this.setPaused(true);
      this.menus && this.menus.showContextLost(true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.gpu = detectGPU(this.renderer.getContext());
      this.menus && this.menus.showContextLost(false);
      this.menus && this.menus.updateGpuInfo();
    });
    this.renderer.setClearColor(0x87b8e8);
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    // near plane 0.15 (not 0.1): 1.5x depth precision so nearly coplanar faces don't flicker far away
    this.camera = new THREE.PerspectiveCamera(this.settings.get('fov'), 1, 0.15, 3000);
    this.camera.rotation.order = 'YXZ';
    this.fog = new THREE.Fog(0xa9cdee, 150, this.quality.drawDist);
    this.scene.fog = this.fog;
    this.baseFogColor = new THREE.Color(0xa9cdee);
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x8a8470, 1.5); // neutral bounce light: ceilings no longer turn dark olive
    this.scene.add(this.hemi);
    this.sunDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
    this.sun.position.copy(this.sunDir).multiplyScalar(200);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.xr = new XRManager(this);
    this.xrPanel = new XRPanel(this.xr);
    this.xr.on('start', () => this.onVrStart());
    this.xr.on('end', () => this.onVrEnd());
    // headset test mode (fixed scenarios + console reports), see src/debug/VrTests.js
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('vrtest')) import('../debug/VrTests.js').then((mod) => { this.vrTests = new mod.VrTests(this); });
    this.applyQuality();

    this.audio = new AudioEngine(this.settings);
    this.menus = new Menus(this);
    this.debug = new DebugOverlay(this);
    this.touch = new TouchControls(this);
    this.input.onLockFailed = () => {
      const msg = 'Mouse capture is blocked here — move the mouse over the game to look (arrow keys work too). For the best controls open the game in its own tab / fullscreen.';
      if (this.match) this.match.hud.toast(msg, '#ffd76a');
      console.info('[Storm Island] pointer lock unavailable, using free-mouse look');
    };

    this.input.onTouchModeChange = (touch) => {
      if (touch) this.input.exitLock();
      this.applyQuality();
      this.menus.updateTouchUi();
      console.info(`[Storm Island] switched to ${touch ? 'touch' : 'mouse & keyboard'} controls`);
    };
    this.input.onCtrlWarn = () => {
      if (!this.match || this.ctrlWarned === this.match) return;
      this.ctrlWarned = this.match;
      this.match.hud.toast('Careful: Ctrl+W closes the browser tab. Crouch with C — or press FULLSCREEN (pause menu), where Ctrl is safe and crouches.', '#ffd76a');
    };
    // leaving the fullscreen releases the keyboard lock
    const onFs = () => {
      if (!(document.fullscreenElement || document.webkitFullscreenElement)) this.input.keyboardLocked = false;
      this.menus && this.menus.updateTouchUi();
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    // safety net: if a browser shortcut still tries to close / leave the page mid-match, ask first
    window.addEventListener('beforeunload', (e) => {
      if (this.match && this.isPlaying() && this.match.phase !== 'over') { e.preventDefault(); e.returnValue = ''; }
    });
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKeyRaw = (e) => this.onKeyRaw(e);
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('click', () => {
      if (this.match && this.isPlaying() && !this.paused && !this.match.mapOpen && !this.input.locked && !this.input.touchMode) this.input.requestLock();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.match && this.isPlaying() && !this.xr.presenting) this.setPaused(true);
    });
    this.settings.onChange((k) => this.onSetting(k));
    this.resize();
    this.acc = 0;
    this.last = performance.now();
    this.frameTimes = [];
    this.simMs = 0;
  }

  start() {
    this.setState('menu');
    // setAnimationLoop = requestAnimationFrame on a flat screen, and the headset's own frame loop in VR
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  isPlaying() { return this.state === 'bus' || this.state === 'match' || this.state === 'spectate'; }

  applyQuality() {
    const q = this.quality;
    // phones: never go below 1.0 (tiny screens get blurry), never above 1.0 either (fill rate)
    const pr = this.input.touchMode ? 1.0 : Math.min(2, Math.min(window.devicePixelRatio || 1, q.pixelRatio) * (q.renderScale || 1));
    if (!this.renderer.xr.isPresenting) this.renderer.setPixelRatio(pr); // the headset sets its own resolution
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMapping = q.cinematic ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = q.cinematic ? 1.25 : 1;
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      const r = q.shadowRange;
      const cam = this.sun.shadow.camera;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 500;
      cam.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.04;
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.fog.far = q.drawDist;
    this.fog.near = Math.min(150, q.drawDist * 0.3);
    this.camera.far = Math.max(2600, q.drawDist + 200);
    this.camera.updateProjectionMatrix();
  }

  onSetting(k) {
    if (k === 'quality') {
      this.quality = QUALITY[this.settings.get('quality')] || QUALITY.medium;
      this.applyQuality();
      this.resize();
    }
    if (k === 'fov' && this.match) this.match.cameraRig.baseFov = this.settings.get('fov');
    this.audio.applyVolumes();
  }

  resize() {
    if (this.renderer.xr.isPresenting) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.match) this.match.onResize(w, h);
  }

  setState(s) {
    this.state = s;
    this.menus.onState(s);
    if (s === 'menu' || s === 'results') this.input.exitLock();
    if (this.xr.active) this.vrPanelForState();
  }

  // ---------- VR ----------
  /** PLAY IN VR (must run from a click: the browser only opens a headset session on a user gesture). */
  async startVR() {
    this.audio.unlock();
    const ok = await this.xr.start();
    if (!ok) { this.menus.vrFailed(); return; }
    if (this.match && this.isPlaying()) { this.match.ensureXR(); if (this.paused) this.showVrPause(); }
    else this.startMatch({ vr: true });
  }

  onVrStart() {
    document.body.classList.add('vr');
    this.input.xrOnly = true;
    if (this.xr.presenting) this.input.exitLock();
    this.input.releaseAll();
    if (this.match && this.isPlaying()) { this.match.ensureXR(); if (this.paused) this.showVrPause(); else this.xrPanel.hide(); }
    else this.vrPanelForState();
  }

  onVrEnd() {
    document.body.classList.remove('vr');
    this.input.xrOnly = false;
    this.xrPanel.hide();
    if (this.match && this.match.xrPlayer) this.match.xrPlayer.deactivate();
    if (this.match && this.isPlaying() && !this.paused) this.setPaused(true);
    this.resize();
  }

  /** Headset menu opened / headset taken off. */
  onVrBlur() { if (this.match && this.isPlaying() && !this.paused) this.setPaused(true); }

  vrPanelForState() {
    const P = this.xrPanel, s = this.state;
    if (s === 'menu') {
      P.show({ title: 'STORM ISLAND', lines: ['Battle royale in VR', `${Number(this.settings.get('vrBots')) + 1} players · ${this.settings.get('difficulty')} bots`, 'Point with a controller, press the trigger'],
        buttons: [{ id: 'play', label: 'PLAY', primary: true }, { id: 'exit', label: 'EXIT VR' }] },
      (id) => { if (id === 'play') this.startMatch({ vr: true }); else this.xr.end(); });
    } else if (s === 'lobby') {
      P.show({ title: 'MATCHMAKING', lines: ['Generating the island...'] }, null);
    } else if (s === 'results') {
      const r = this.results;
      P.show({ title: r && r.won ? 'STORM CHAMPION' : r ? `YOU PLACED #${r.placement}` : 'MATCH OVER',
        lines: r ? [`${r.kills} eliminations · ${Math.round(r.damage)} damage · ${r.accuracy}% accuracy`, `Survived ${formatTime(r.time)} · ${r.players} players`] : [],
        buttons: [{ id: 'again', label: 'PLAY AGAIN', primary: true }, { id: 'menu', label: 'MENU' }, { id: 'exit', label: 'EXIT VR' }] },
      (id) => { if (id === 'again') this.startMatch({ vr: true }); else if (id === 'menu') this.setState('menu'); else this.xr.end(); });
    } else P.hide();
  }

  /** Full Touch controller layout (pause menu → CONTROLS). */
  showVrControls() {
    const left = this.settings.get('vrHand') === 'left';
    const gun = left ? 'LEFT' : 'RIGHT', other = left ? 'RIGHT' : 'LEFT';
    const [a, b] = left ? ['X', 'Y'] : ['A', 'B'], [x, y] = left ? ['A', 'B'] : ['X', 'Y'];
    this.xrPanel.show({ title: 'CONTROLS', small: true, lines: [
      `${gun} (gun hand): TRIGGER fire · GRIP grab loot / open chest`,
      `${a} jump / glider · ${b} reload · STICK ←→ turn · STICK ↑↓ weapon`,
      'STICK CLICK crouch · swing the pickaxe with your arm',
      'Grenades: hold TRIGGER, throw with your arm, release',
      `${other}: STICK move (click = sprint) · TRIGGER aim`,
      `${x} build mode · ${y} this menu · GRIP (hold) big map`,
      `Build mode: TRIGGER place · STICK ↑↓ piece · ${b} rotate`,
      `   ${other} TRIGGER material · STICK CLICK edit · ${x} exit`,
      'Look at your wrist: health, ammo, materials, map',
      'Duck in real life to crouch · raise a controller to see hints',
    ], buttons: [{ id: 'back', label: 'BACK', primary: true }] }, () => this.showVrPause(false), false);
  }

  showVrPause(reposition = true) {
    const st = this.settings;
    const turn = st.get('vrTurn') === 'smooth' ? 'Smooth turn' : `Snap turn ${st.get('vrSnapAngle')}°`;
    const move = st.get('vrMove') === 'teleport' ? 'Teleport' : 'Smooth move';
    const lines = [`${turn} · ${move} · vignette ${st.get('vrVignette')}`];
    if (!this.xr.hasControllers()) lines.unshift('Pick up your Touch controllers to play');
    this.xrPanel.show({ title: 'PAUSED', lines, buttons: [
      { id: 'resume', label: 'RESUME', primary: true }, { id: 'turn', label: 'TURN: ' + (st.get('vrTurn') === 'smooth' ? 'SMOOTH' : 'SNAP') },
      { id: 'move', label: 'MOVE: ' + (st.get('vrMove') === 'teleport' ? 'TELEPORT' : 'STICK') }, { id: 'vig', label: 'VIGNETTE: ' + String(st.get('vrVignette')).toUpperCase() },
      { id: 'calib', label: 'RESET HEIGHT' }, { id: 'controls', label: 'CONTROLS' },
      { id: 'exit', label: 'EXIT VR' }, { id: 'leave', label: 'LEAVE MATCH', danger: true },
    ] }, (id) => {
      if (id === 'resume') { this.setPaused(false); return; }
      if (id === 'controls') { this.showVrControls(); return; }
      if (id === 'turn') st.set('vrTurn', st.get('vrTurn') === 'smooth' ? 'snap' : 'smooth');
      if (id === 'move') st.set('vrMove', st.get('vrMove') === 'teleport' ? 'stick' : 'teleport');
      if (id === 'vig') { const o = ['off', 'low', 'strong']; st.set('vrVignette', o[(o.indexOf(st.get('vrVignette')) + 1) % 3]); }
      if (id === 'calib') { this.xr.calib = 0; this.xr.calibT = 0; this.xr.calibSum = 0; if (this.match) this.match.hud.toast('Stand up straight — measuring your height', '#7fd4ff'); }
      if (id === 'exit') { this.xr.end(); return; }
      if (id === 'leave') { this.xrPanel.hide(); this.leaveMatch(this.match && this.match.player && !this.match.player.alive); return; }
      this.showVrPause(false);
    }, reposition);
  }


  /** Menu -> Lobby: build the world while the lobby screen shows, then launch the bus. */
  startMatch(opts = {}) {
    this.audio.unlock();
    if (this.match) { this.match.dispose(); this.match = null; }
    const vr = !!opts.vr || this.xr.active;
    // VR matches use the headset preset and their own (smaller) lobby size
    this.quality = vr ? QUALITY[this.settings.get('vrQuality') === 'performance' ? 'vrPerf' : 'vr'] : (QUALITY[this.settings.get('quality')] || QUALITY.medium);
    this.applyQuality();
    this.setState('lobby');
    const seed = resolveSeed(this.settings.get('seed'));
    const bots = Math.max(10, Math.min(99, Number(this.settings.get(vr ? 'vrBots' : 'botCount')) || 49));
    const difficulty = this.settings.get('difficulty');
    const map = {};
    for (const k of Object.keys(MAP_OPTIONS)) map[k] = this.settings.get(k);
    this.menus.lobbyProgress('Generating island (seed ' + seed + ')...', 0.1);
    // Let the lobby UI paint before the (synchronous) generation.
    setTimeout(() => {
      try {
        this.match = new Match(this, { seed, botCount: bots, difficulty, map });
      } catch (e) {
        console.error(e);
        this.menus.lobbyProgress('World generation failed: ' + e.message, 1);
        return;
      }
      this.menus.runLobbyCountdown(bots + 1, () => {
        if (!this.match) return;
        this.match.begin();
        this.setState('bus');
        if (!this.xr.presenting) this.input.requestLock();
      });
    }, 60);
  }

  leaveMatch(toResults = false) {
    if (!this.match) { this.setState('menu'); return; }
    if (toResults) {
      this.results = this.match.buildResults();
    }
    this.match.dispose();
    this.match = null;
    this.paused = false;
    this.audio.stopMatchSounds();
    this.setState(toResults ? 'results' : 'menu');
  }

  setPaused(p) {
    if (this.paused === p) return;
    this.paused = p;
    this.menus.showPause(p);
    if (this.xr.active) { if (p) this.showVrPause(); else this.xrPanel.hide(); }
    if (p) { this.input.exitLock(); this.audio.duck(true); }
    else { if (!this.xr.presenting) this.input.requestLock(); this.audio.duck(false); this.last = performance.now(); }
  }

  onLockChange(locked) {
    if (!locked && this.match && this.isPlaying() && !this.paused && !this.match.allowUnlocked()) this.setPaused(true);
  }

  onKeyRaw(e) {
    if (e.code === 'F3') { this.debug.toggle(); return true; }
    if (e.code === 'Escape' && this.match && this.isPlaying()) {
      if (this.match.closeOverlays()) return true;
      // Escape also exits pointer lock natively; lock-loss handler shows pause.
      if (this.paused) { this.setPaused(false); return true; }
      // without pointer lock (free mouse / touch) Esc must open the pause menu itself
      if (!this.input.locked) { this.setPaused(true); return true; }
      return false;
    }
    if (this.match && (e.code === 'Backquote' || e.code === 'F2') && this.debugMode) { this.match.toggleDebugPanel(); return true; }
    return false;
  }

  frame(t) {
    if (this.contextLost) { this.last = performance.now(); return; }
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const m = this.match;
    const vr = this.xr.active;
    this.xr.poll(dt);
    this.input.wantLook = !!(m && m.begun && this.isPlaying() && !this.paused && !m.mapOpen) && !vr;
    this.touch.setVisible(!vr && !!m && m.begun && this.isPlaying() && !this.paused);
    this.touch.update();
    if (vr) this.vrFrame(m);
    if (m && m.begun && !this.paused) {
      if (vr && m.xrPlayer) m.xrPlayer.preTick(dt);
      const s0 = performance.now();
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 6) {
        m.tick(DT);
        this.input.endTick();
        this.acc -= DT;
        steps++;
      }
      if (steps === 6) this.acc = 0;
      this.simMs = performance.now() - s0;
      m.render(this.acc / DT, dt);
    } else if (m) {
      m.render(1, dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.menus.update(dt);
    this.debug.update(dt);
  }

  /** VR housekeeping per frame: panel pointers, simulator clicks, controllers put down mid-match. */
  vrFrame(m) {
    const xr = this.xr;
    if (xr.simActive) { const { main } = xr.hands(); if (main && main.pad.trigger > 0.5 && main.prev.trigger <= 0.5) xr.emit('select', main); }
    const has = xr.hasControllers();
    if (xr.presenting && m && this.isPlaying() && this.vrHadControllers && !has && !this.paused) this.setPaused(true);
    this.vrHadControllers = has;
    this.xrPanel.tick();
  }
}
