// Menu screens: main menu, settings (incl. key rebinding), controls, lobby countdown, pause, results.
import { KEY_LABELS } from '../core/Settings.js';
import { formatTime } from '../core/math.js';
import { escapeHtml } from './HUD.js';
import { MAP_OPTIONS } from '../world/MapOptions.js';

const botFmt = (v) => `${v} (${Number(v) + 1} players)`;

const TOUCH_CONTROLS = [
  ['Left side', 'Floating joystick — push to the rim to sprint'], ['Right side', 'Drag to look around'],
  ['FIRE', 'Shoot / swing / use item / place piece — drag it to aim while firing'], ['AIM', 'Toggle aim down sights · in build mode: switch material'],
  ['JUMP', 'Jump · drop from the bus · deploy glider'], ['CROUCH', 'Toggle crouch'], ['RELOAD', 'Reload · in build mode: rotate stairs'],
  ['USE', 'Appears near loot/chests'], ['BUILD', 'Build mode (hotbar shows wall/floor/stairs/roof)'], ['EDIT', 'Edit your wall/floor; aim at a tile and press FIRE'],
  ['Hotbar', 'Tap a slot to select it'], ['MAP / MENU', 'Map (tap to mark) / pause & settings'],
];

const CONTROLS = [
  ['W A S D', 'Move'], ['Shift', 'Sprint'], ['Space', 'Jump · jump from bus · deploy glider'], ['C (Ctrl in fullscreen)', 'Crouch'],
  ['Mouse', 'Look'], ['LMB', 'Fire / swing / use item / place build'], ['RMB', 'Aim down sights · (build) switch material'],
  ['E', 'Pick up · open chest'], ['R', 'Reload · (build) rotate stairs · (edit) reset'], ['1', 'Pickaxe (also F)'], ['2 – 6', 'Item slots'],
  ['Mouse wheel', 'Cycle slots / build pieces'], ['Q', 'Toggle build mode'], ['Z X T Y', 'Quick build: wall, floor, stairs, roof'],
  ['G', 'Edit your wall/floor (LMB toggles tiles)'], ['V', 'Swap shoulder'], ['B', 'Emote'], ['M / Tab', 'Map (click to place marker)'],
  ['Esc', 'Pause / settings'], ['F3', 'Debug overlay (FPS, bots, nav grid)'],
];

export class Menus {
  constructor(game) {
    this.game = game;
    const root = document.createElement('div');
    root.id = 'menus';
    root.innerHTML = `
      <div class="screen main-menu">
        <div class="menu-bg"></div>
        <div class="title-wrap">
          <div class="logo">STORM<span>ISLAND</span></div>
          <div class="tagline">Drop in. Loot up. Build fast. Be the last one standing.</div>
        </div>
        <div class="menu-buttons">
          <button class="btn primary big" data-act="play">PLAY</button>
          <button class="btn" data-act="settings">SETTINGS</button>
          <button class="btn" data-act="controls">CONTROLS</button>
          <button class="btn fs-btn hidden" data-act="fullscreen">FULLSCREEN</button>
        </div>
        <div class="gpu-badge" data-act="gpuhelp" title="Graphics card used by the browser"></div>
        <div class="menu-foot">Fan-made browser battle royale · all art & audio procedurally generated · <span class="foot-lobby"></span></div>
      </div>
      <div class="screen panel gpuhelp hidden">
        <div class="panel-box gpu-box"></div>
      </div>
      <div class="screen ctxlost hidden">
        <div class="pause-box"><h2>Graphics reset</h2><p>The GPU context was lost (driver reset or GPU switch). Waiting for the browser to restore it…</p><p class="note">If nothing happens, reload the page (F5).</p></div>
      </div>
      <div class="screen lobby hidden">
        <div class="menu-bg"></div>
        <div class="lobby-box">
          <div class="lobby-title">MATCHMAKING</div>
          <div class="lobby-status">Preparing...</div>
          <div class="lobby-bar"><i></i></div>
          <div class="lobby-count"></div>
          <div class="lobby-tip"></div>
        </div>
      </div>
      <div class="screen panel settings hidden">
        <div class="panel-box">
          <h2>Settings</h2>
          <p class="settings-gpu note"></p>
          <div class="settings-grid"></div>
          <h3>Key bindings <button class="btn small" data-act="resetkeys">Reset</button></h3>
          <div class="keys-grid"></div>
          <div class="panel-actions"><button class="btn primary" data-act="back">Done</button></div>
        </div>
      </div>
      <div class="screen panel controls hidden">
        <div class="panel-box">
          <h2>Controls</h2>
          <h3 class="ct-touch-h">Touch</h3>
          <table class="controls-table ct-touch">${TOUCH_CONTROLS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>
          <h3 class="ct-touch-h">Keyboard & mouse</h3>
          <table class="controls-table">${CONTROLS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>
          <p class="note">Tip: Ctrl+W (crouch + forward) closes a browser tab and no web page can block it — crouch with <kbd>C</kbd>, or press FULLSCREEN: in fullscreen Chrome / Edge let the game capture Ctrl, so Ctrl crouches safely there. Click the game to capture the mouse.</p>
          <div class="panel-actions"><button class="btn primary" data-act="back">Back</button></div>
        </div>
      </div>
      <div class="screen pause hidden">
        <div class="pause-box">
          <h2>Paused</h2>
          <button class="btn primary" data-act="resume">RESUME</button>
          <button class="btn" data-act="settings">SETTINGS</button>
          <button class="btn" data-act="controls">CONTROLS</button>
          <button class="btn fs-btn hidden" data-act="fullscreen">FULLSCREEN</button>
          <button class="btn danger" data-act="leave">LEAVE MATCH</button>
        </div>
      </div>
      <div class="screen results hidden">
        <div class="menu-bg"></div>
        <div class="results-box"></div>
      </div>
    `;
    game.uiRoot.appendChild(root);
    this.root = root;
    this.q = (s) => root.querySelector(s);
    this.panelReturn = 'main';
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      e.preventDefault();
      this.game.audio.unlock();
      this.game.audio.ui('click');
      this.onAction(b.dataset.act);
    });
    this.buildSettings();
    this.updateGpuInfo();
    this.updateTouchUi();
    this.lobbyTimer = null;
  }

  /** GPU badge on the main menu + help panel explaining how to move the browser to the dedicated GPU. */
  updateGpuInfo() {
    const gpu = this.game.gpu;
    if (!gpu) return;
    const badge = this.q('.gpu-badge');
    const warn = gpu.kind === 'integrated' || gpu.kind === 'software';
    badge.className = 'gpu-badge ' + (warn ? 'warn' : gpu.kind === 'discrete' ? 'ok' : '');
    badge.innerHTML = warn
      ? `⚠ Running on <b>${escapeHtml(gpu.name)}</b>${gpu.kind === 'software' ? ' (software rendering!)' : ' (integrated GPU)'} — <u>use your dedicated GPU</u>`
      : `GPU: <b>${escapeHtml(gpu.name)}</b>${gpu.kind === 'discrete' ? ' ✓' : ''}`;
    const b = gpu.browser;
    const box = this.q('.gpu-box');
    box.innerHTML = `
      <h2>Graphics card</h2>
      <p>The game is currently rendered by: <b>${escapeHtml(gpu.name)}</b> <span class="gpu-kind ${gpu.kind}">${gpu.kind}</span></p>
      <p class="note">${escapeHtml(gpu.raw || 'renderer string unavailable')}</p>
      <p>A web page can only <i>ask</i> for the fast GPU (Storm Island requests <code>powerPreference: "high-performance"</code>).
      On laptops with Intel/AMD graphics + an NVIDIA card (e.g. GTX 1050), <b>Windows decides per program</b>,
      so the browser itself has to be assigned to the NVIDIA card:</p>
      <ol class="gpu-steps">
        <li><b>Windows settings</b> (Windows 10/11): <i>Settings → System → Display → Graphics settings</i>
          (Win 11: <i>System → Display → Graphics</i>) →
          ${b.store ? `<i>Microsoft Store app</i> → pick <b>Claude</b> → <i>Add</i>` : `<i>Desktop app → Browse</i> → select
          <code>${escapeHtml(b.exe)}</code>${b.path ? ` (usually <code>${escapeHtml(b.path)}</code>)` : ''}`} → <i>Options</i> →
          <b>High performance (NVIDIA …)</b> → <i>Save</i>.
          <br><span class="note">Shortcut for Chrome/Edge/Brave/Firefox: run <code>tools\\use-nvidia-gpu.ps1</code> from the game folder (right-click → Run with PowerShell).</span></li>
        <li><b>or NVIDIA Control Panel</b>: right-click the desktop → <i>NVIDIA Control Panel → Manage 3D settings → Program Settings</i> →
          <i>Add</i> <code>${escapeHtml(b.exe)}</code> → preferred graphics processor: <b>High-performance NVIDIA processor</b> → <i>Apply</i>.</li>
        ${b.flags ? `<li><b>${escapeHtml(b.name)} flag</b> (optional, extra push): open <code>${escapeHtml(b.flags)}</code> → set
          <i>“Force high-performance GPU”</i> to <b>Enabled</b>.</li>` : ''}
        <li><b>Fully close the browser</b> (all windows, also the tray icon) and start it again. Plug the laptop into power —
          on battery the driver may still prefer the integrated GPU.</li>
        <li>Check: this panel / the main menu should now show <b>NVIDIA GeForce GTX…</b>${b.gpuPage ? `, and <code>${escapeHtml(b.gpuPage)}</code> lists it as the active GPU` : ''}.</li>
      </ol>
      <p class="note">Also make sure hardware acceleration is on (${escapeHtml(b.name)} settings → System → “Use graphics acceleration when available”).
      If you play inside the Claude desktop app's browser pane, assign <code>Claude.exe</code> the same way — or just open the game in Chrome/Edge.</p>
      <div class="panel-actions"><button class="btn primary" data-act="back">OK</button></div>`;
    const sg = this.q('.settings-gpu');
    if (sg) sg.innerHTML = `GPU: <b>${escapeHtml(gpu.name)}</b> (${gpu.kind}) · <a href="#" data-act="gpuhelp">how to use the dedicated GPU</a>`;
  }

  updateTouchUi() {
    const fsOk = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    this.root.querySelectorAll('.fs-btn').forEach((b) => b.classList.toggle('hidden', !fsOk || fs));
  }

  showContextLost(on) { this.q('.ctxlost').classList.toggle('hidden', !on); }

  onAction(act) {
    const g = this.game;
    switch (act) {
      case 'play': g.startMatch(); break;
      case 'settings': this.openPanel('settings'); break;
      case 'controls': this.openPanel('controls'); break;
      case 'fullscreen': goFullscreen(g.input); break;
      case 'gpuhelp': this.q('.settings').classList.add('hidden'); this.openPanel('gpuhelp'); break;
      case 'back': this.closePanel(); break;
      case 'resetkeys': g.settings.resetKeys(); this.buildSettings(); break;
      case 'maprandom': for (const k of Object.keys(MAP_OPTIONS)) g.settings.set(k, 'random'); this.buildSettings(); break;
      case 'resume': this.showPause(false); g.setPaused(false); break;
      case 'leave': g.leaveMatch(g.match && g.match.player && !g.match.player.alive); break;
      case 'again': g.startMatch(); break;
      case 'menu': g.setState('menu'); break;
    }
  }

  openPanel(name) {
    this.panelReturn = this.game.state === 'menu' ? 'main' : 'pause';
    this.q('.pause').classList.add('hidden');
    this.q('.main-menu').classList.add('hidden');
    this.q('.' + name).classList.remove('hidden');
  }
  closePanel() {
    this.q('.settings').classList.add('hidden');
    this.q('.controls').classList.add('hidden');
    this.q('.gpuhelp').classList.add('hidden');
    if (this.panelReturn === 'pause' && this.game.paused) this.q('.pause').classList.remove('hidden');
    else if (this.game.state === 'menu') this.q('.main-menu').classList.remove('hidden');
  }

  buildSettings() {
    const s = this.game.settings;
    const grid = this.q('.settings-grid');
    const row = (label, html) => `<label class="srow"><span>${label}</span>${html}</label>`;
    const range = (key, min, max, step, fmt = (v) => v) => `<input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${s.get(key)}"><output>${fmt(s.get(key))}</output>`;
    const select = (key, opts) => `<select data-key="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(s.get(key)) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    grid.innerHTML = [
      row('Mouse sensitivity', range('sensitivity', 0.1, 3, 0.05)),
      row('ADS sensitivity', range('adsSensitivity', 0.2, 1.5, 0.05)),
      row('Invert Y', `<input type="checkbox" data-key="invertY" ${s.get('invertY') ? 'checked' : ''}>`),
      row('Field of view', range('fov', 60, 100, 1)),
      row('Touch controls', select('touchControls', [['auto', 'Auto (follows touch / mouse)'], ['on', 'Always on'], ['off', 'Off']])),
      row('Touch look sensitivity', range('touchSensitivity', 0.3, 3, 0.05)),
      row('Touch: auto-fire on target', `<input type="checkbox" data-key="touchAutoFire" ${s.get('touchAutoFire') ? 'checked' : ''}>`),
      row('Touch: aim assist', `<input type="checkbox" data-key="touchAimAssist" ${s.get('touchAimAssist') ? 'checked' : ''}>`),
      row('Touch: left FIRE button', `<input type="checkbox" data-key="touchLeftFire" ${s.get('touchLeftFire') ? 'checked' : ''}>`),
      row('Graphics quality', select('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])),
      row('Master volume', range('master', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')),
      row('Effects volume', range('sfx', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')),
      row('Music volume', range('music', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')),
      row('Bots (+ you = players, max 100)', range('botCount', 10, 99, 1, botFmt)),
      row('Bot difficulty', select('difficulty', [['mixed', 'Mixed'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['expert', 'Expert']])),
      row('Map seed (blank = random)', `<input type="text" data-key="seed" value="${escapeHtml(s.get('seed'))}" placeholder="random" maxlength="24">`),
      '<h3 class="settings-sub">Map generation <button class="btn small" data-act="maprandom">Randomize all</button></h3>',
      ...Object.entries(MAP_OPTIONS).map(([k, o]) => row(o.label, select(k, [...o.values, ['random', 'Random']]))),
    ].join('') + '<p class="note">High quality: anti-aliasing applies after a page reload; terrain detail and grass density with the next match. Bots, difficulty, seed and map options apply to the next match. Touch controls switch immediately.</p>';
    grid.querySelectorAll('[data-key]').forEach((el) => {
      const key = el.dataset.key;
      const out = el.parentElement.querySelector('output');
      const handler = () => {
        let v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
        s.set(key, v);
        if (key === 'touchControls') { this.game.input.setTouchMode(this.game.input.resolveTouchSetting()); this.game.applyQuality(); this.updateTouchUi(); }
        if (out) out.textContent = ['master', 'sfx', 'music'].includes(key) ? Math.round(v * 100) + '%' : key === 'botCount' ? botFmt(v) : v;
      };
      el.addEventListener(el.type === 'text' ? 'change' : 'input', handler);
    });
    const kg = this.q('.keys-grid');
    kg.innerHTML = Object.keys(KEY_LABELS).map((a) => `<div class="krow"><span>${KEY_LABELS[a]}</span><button class="keybtn" data-bind="${a}">${prettyKey(s.data.keys[a])}</button></div>`).join('');
    kg.querySelectorAll('[data-bind]').forEach((b) => b.addEventListener('click', () => {
      b.textContent = 'press a key...';
      b.classList.add('wait');
      this.game.input.captureNextKey = (code) => {
        if (code !== 'Escape') { const keys = { ...s.data.keys, [b.dataset.bind]: code }; s.set('keys', keys); }
        b.textContent = prettyKey(s.data.keys[b.dataset.bind]);
        b.classList.remove('wait');
      };
    }));
  }

  onState(st) {
    const show = (sel, on) => this.q(sel).classList.toggle('hidden', !on);
    show('.main-menu', st === 'menu');
    show('.lobby', st === 'lobby');
    show('.results', st === 'results');
    show('.settings', false);
    show('.controls', false);
    show('.gpuhelp', false);
    show('.pause', false);
    if (st === 'menu') this.game.audio.playMenuMusic(true);
    if (st === 'bus') this.game.audio.playMenuMusic(false);
    if (st === 'results') this.renderResults();
    if (st === 'menu') {
      const s = this.game.settings;
      this.q('.foot-lobby').textContent = `${Number(s.get('botCount')) + 1} players · ${s.get('difficulty')} bots · ${s.get('mapTheme')} map · ${s.get('quality')} quality`;
    }
  }

  lobbyProgress(text, p) {
    this.q('.lobby-status').textContent = text;
    this.q('.lobby-bar i').style.width = (p * 100) + '%';
  }

  runLobbyCountdown(total, done) {
    const tips = ['Tip: pickaxe the blue weak spot for double materials.', 'Tip: build a wall the moment you get shot.', 'Tip: the white circle is safe now — the blue one is next.',
      'Tip: chests glow and hum — follow the sound.', 'Tip: crouching and aiming tightens your bloom.', 'Tip: storm damage ignores shields. Move early.'];
    this.q('.lobby-tip').textContent = tips[Math.floor(Math.random() * tips.length)];
    let n = 1;
    const start = performance.now();
    clearInterval(this.lobbyTimer);
    this.lobbyTimer = setInterval(() => {
      const t = (performance.now() - start) / 1000;
      n = Math.min(total, Math.round(1 + (total - 1) * Math.min(1, t / 2.2)));
      this.q('.lobby-count').textContent = `Players: ${n} / ${total}`;
      this.lobbyProgress(n < total ? 'Finding players...' : 'The Sky Bus is boarding!', 0.3 + 0.7 * Math.min(1, t / 3));
      if (t > 3.2) { clearInterval(this.lobbyTimer); done(); }
    }, 100);
  }

  showPause(on) {
    this.q('.pause').classList.toggle('hidden', !on);
    if (!on) { this.q('.settings').classList.add('hidden'); this.q('.controls').classList.add('hidden'); }
  }

  renderResults() {
    const r = this.game.results;
    const box = this.q('.results-box');
    if (!r) { box.innerHTML = '<button class="btn primary" data-act="menu">MENU</button>'; return; }
    box.innerHTML = `
      ${r.won ? '<div class="victory">STORM CHAMPION</div>' : `<div class="placed">You placed <b>#${r.placement}</b></div>`}
      <div class="res-sub">${r.won ? 'Last one standing on Storm Island!' : r.killedBy ? `Eliminated by ${escapeHtml(r.killedBy)}` : 'Eliminated'} · ${r.players} players</div>
      <div class="res-stats">
        <div><b>${r.kills}</b><span>Eliminations</span></div>
        <div><b>${Math.round(r.damage)}</b><span>Damage dealt</span></div>
        <div><b>${formatTime(r.time)}</b><span>Time survived</span></div>
        <div><b>${r.mats}</b><span>Materials gathered</span></div>
        <div><b>${r.accuracy}%</b><span>Accuracy</span></div>
        <div><b>${r.built}</b><span>Structures built</span></div>
      </div>
      <div class="res-buttons"><button class="btn primary big" data-act="again">PLAY AGAIN</button><button class="btn" data-act="menu">MENU</button></div>`;
    this.game.audio.ui(r.won ? 'victory' : 'defeat');
  }

  update() { }
}

/** Fullscreen + landscape lock where supported (Android Chrome, iPad Safari). iPhone Safari has no
 * element fullscreen: there "Add to Home Screen" gives a full-screen web app (see index.html meta tags). */
// Keys whose browser shortcuts (Ctrl+W close tab, Ctrl+T/N new tab/window, Ctrl+Tab...) get captured
// in fullscreen via the Keyboard Lock API (Chrome / Edge / Opera). Escape is NOT locked, so it still
// exits pointer lock / fullscreen normally.
const LOCK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyN', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyY', 'KeyB', 'KeyV', 'KeyC', 'KeyM',
  'Tab', 'Space', 'ControlLeft', 'ControlRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];

function goFullscreen(input) {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  try {
    const p = req.call(el, { navigationUI: 'hide' });
    const after = () => {
      try { const o = screen.orientation; if (o && o.lock && input && input.touchMode) o.lock('landscape').catch(() => {}); } catch { /* ignore */ }
      try {
        if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(LOCK_KEYS).then(() => { if (input) input.keyboardLocked = true; }).catch(() => {});
      } catch { /* ignore */ }
    };
    if (p && p.then) p.then(after).catch(() => {}); else after();
  } catch { /* ignore */ }
}

function prettyKey(code) {
  if (!code) return '—';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R');
}
