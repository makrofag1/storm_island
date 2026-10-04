// Fully procedural audio (Web Audio API): spatialized SFX, ambient loops and a generated lobby theme.

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.voices = 0;
    this.maxVoices = 48;
    this.lx = 0; this.ly = 0; this.lz = 0;
    this.musicOn = false;
    this.ducked = false;
    this.loops = {};
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      const c = this.ctx;
      this.master = c.createGain();
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
      this.master.connect(this.comp).connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.music = c.createGain(); this.music.connect(this.master);
      this.amb = c.createGain(); this.amb.connect(this.master);
      // shared noise buffers
      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.brown = c.createBuffer(1, len, c.sampleRate);
      const b = this.brown.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
      this.applyVolumes();
      this.initLoops();
      if (this.wantMusic) this.playMenuMusic(true);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.get('master') * (this.ducked ? 0.35 : 1), t, 0.05);
    this.sfx.gain.setTargetAtTime(s.get('sfx'), t, 0.05);
    this.amb.gain.setTargetAtTime(s.get('sfx') * 0.9, t, 0.05);
    this.music.gain.setTargetAtTime(s.get('music') * 0.55, t, 0.05);
  }
  duck(on) { this.ducked = on; this.applyVolumes(); }

  setListener(x, y, z, fx, fy, fz) {
    this.lx = x; this.ly = y; this.lz = z;
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      L.setPosition(x, y, z);
      L.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  // ---------- helpers ----------
  _voice(dur) {
    if (this.voices >= this.maxVoices) return false;
    this.voices++;
    setTimeout(() => { this.voices--; }, (dur + 0.1) * 1000);
    return true;
  }
  /** Output node for a sound at (x,y,z) (or non-spatial if x is null). Returns {node, dist} or null. */
  _out(x, y, z, maxDist = 400, ref = 6, dur = 1) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return null;
    let dist = 0;
    if (x !== null && x !== undefined) {
      dist = Math.hypot(x - this.lx, y - this.ly, z - this.lz);
      if (dist > maxDist) return null;
    }
    if (!this._voice(dur)) return null;
    const g = c.createGain();
    if (x === null || x === undefined) { g.connect(this.sfx); return { node: g, dist: 0 }; }
    const p = c.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = maxDist; p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    // distance muffling
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(700, 16000 * Math.exp(-dist / 90));
    g.connect(lp).connect(p).connect(this.sfx);
    return { node: g, dist };
  }
  _noise(out, t, dur, type, freq, q, gain, attack = 0.002, buf = null, sweepTo = null) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf || this.noise;
    src.loop = dur > 1.9;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }
  _tone(out, t, dur, type, f0, f1, gain, attack = 0.002) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------- SFX ----------
  gun(type, x, y, z, local) {
    const P = {
      ar: { lp: 3200, dec: 0.16, th: 150, vol: 0.75, crack: 0.35 },
      smg: { lp: 3800, dec: 0.09, th: 190, vol: 0.55, crack: 0.25 },
      pistol: { lp: 3000, dec: 0.12, th: 210, vol: 0.6, crack: 0.3 },
      shotgun: { lp: 2000, dec: 0.42, th: 85, vol: 1.0, crack: 0.5 },
      sniper: { lp: 2600, dec: 0.75, th: 60, vol: 1.1, crack: 0.8 },
      rocket: { lp: 1200, dec: 0.6, th: 70, vol: 0.9, crack: 0.1 },
    }[type] || { lp: 3000, dec: 0.15, th: 150, vol: 0.7, crack: 0.3 };
    const o = this._out(local ? null : x, y, z, type === 'sniper' ? 750 : 450, 8, P.dec + 0.3);
    if (!o) return;
    const t = this.ctx.currentTime;
    const v = P.vol * (local ? 0.75 : 1);
    this._noise(o.node, t, P.dec, 'lowpass', P.lp, 0.7, v);
    this._tone(o.node, t, P.dec * 0.8, 'sine', P.th, P.th * 0.35, v * 0.9);
    if (o.dist < 60 || local) this._noise(o.node, t, 0.03, 'highpass', 3000, 0.5, P.crack * v);
    if (type === 'sniper' || type === 'shotgun') this._noise(o.node, t + 0.12, P.dec * 1.3, 'bandpass', 600, 0.6, v * 0.18);
    if (type === 'rocket') this._noise(o.node, t, 0.9, 'bandpass', 400, 1.2, v * 0.5, 0.05, null, 1600);
  }
  dry() { const o = this._out(null, 0, 0, 1, 1, 0.1); if (o) this._tone(o.node, this.ctx.currentTime, 0.04, 'square', 900, 700, 0.12); }
  reload(type, phase) {
    const o = this._out(null, 0, 0, 1, 1, 0.3);
    if (!o) return;
    const t = this.ctx.currentTime;
    if (phase === 'start') { this._noise(o.node, t, 0.05, 'bandpass', 1800, 4, 0.35); this._tone(o.node, t + 0.08, 0.05, 'square', 500, 300, 0.08); }
    else { this._noise(o.node, t, 0.04, 'bandpass', 2500, 5, 0.4); this._noise(o.node, t + 0.09, 0.05, 'bandpass', 1500, 5, 0.45); }
  }
  footstep(surface, x, y, z, local) {
    const o = this._out(local ? null : x, y, z, 45, 3, 0.2);
    if (!o) return;
    const t = this.ctx.currentTime;
    const v = local ? 0.18 : 0.35;
    switch (surface) {
      case 'wood': this._tone(o.node, t, 0.08, 'sine', 160, 90, v); this._noise(o.node, t, 0.05, 'bandpass', 700, 2, v * 0.6); break;
      case 'metal': this._noise(o.node, t, 0.06, 'bandpass', 2400, 3, v * 0.7); this._tone(o.node, t, 0.12, 'triangle', 900, 860, v * 0.3); break;
      case 'stone': this._noise(o.node, t, 0.05, 'bandpass', 1300, 1.5, v * 0.8); break;
      case 'water': this._noise(o.node, t, 0.18, 'lowpass', 900, 1, v * 0.9, 0.02); break;
      case 'sand': case 'snow': this._noise(o.node, t, 0.08, 'lowpass', 650, 0.8, v * 0.9, 0.01); break;
      default: this._noise(o.node, t, 0.07, 'lowpass', 1000, 0.8, v * 0.8, 0.005);
    }
  }
  land(local) { const o = this._out(null, 0, 0, 1, 1, 0.3); if (o) { const t = this.ctx.currentTime; this._noise(o.node, t, 0.15, 'lowpass', 500, 1, 0.4); this._tone(o.node, t, 0.12, 'sine', 90, 50, 0.4); } }
  jump() { const o = this._out(null, 0, 0, 1, 1, 0.2); if (o) this._noise(o.node, this.ctx.currentTime, 0.08, 'lowpass', 800, 1, 0.12); }
  swing(local, x, y, z) { const o = this._out(local ? null : x, y, z, 40, 3, 0.3); if (o) this._noise(o.node, this.ctx.currentTime, 0.18, 'bandpass', 900, 1.2, local ? 0.12 : 0.2, 0.05, null, 2400); }
  pickaxeHit(surface, crit, x, y, z, local) {
    const o = this._out(local ? null : x, y, z, 80, 4, 0.5);
    if (!o) return;
    const t = this.ctx.currentTime;
    const v = 0.55;
    if (surface === 'wood') { this._tone(o.node, t, 0.16, 'sine', 210, 120, v); this._noise(o.node, t, 0.08, 'bandpass', 900, 2, v * 0.7); }
    else if (surface === 'metal') { this._tone(o.node, t, 0.3, 'triangle', 1250, 1200, v * 0.35); this._tone(o.node, t, 0.25, 'sine', 1870, 1850, v * 0.25); this._noise(o.node, t, 0.05, 'highpass', 2500, 1, v * 0.5); }
    else if (surface === 'flesh') { this._tone(o.node, t, 0.1, 'sine', 140, 80, v); }
    else { this._noise(o.node, t, 0.09, 'bandpass', 1900, 1.5, v * 0.9); this._tone(o.node, t, 0.06, 'square', 300, 200, v * 0.15); }
    if (crit) { this._tone(o.node, t, 0.35, 'sine', 2400, 2400, 0.25); this._tone(o.node, t + 0.03, 0.3, 'sine', 3600, 3600, 0.12); }
  }
  bulletImpact(surface, x, y, z) {
    const o = this._out(x, y, z, 60, 3, 0.2);
    if (!o) return;
    const t = this.ctx.currentTime;
    if (surface === 'metal') this._tone(o.node, t, 0.15, 'triangle', 1800 + Math.random() * 800, 1500, 0.15);
    this._noise(o.node, t, 0.05, 'bandpass', surface === 'wood' ? 900 : 1800, 2, 0.25);
  }
  build(material, x, y, z, local) {
    const o = this._out(local ? null : x, y, z, 70, 4, 0.4);
    if (!o) return;
    const t = this.ctx.currentTime;
    const v = local ? 0.4 : 0.55;
    if (material === 'wood') { this._tone(o.node, t, 0.1, 'sine', 240, 140, v); this._tone(o.node, t + 0.07, 0.1, 'sine', 300, 170, v * 0.8); }
    else if (material === 'brick') { this._noise(o.node, t, 0.15, 'lowpass', 700, 1, v); this._tone(o.node, t, 0.12, 'sine', 110, 70, v); }
    else { this._tone(o.node, t, 0.25, 'triangle', 600, 560, v * 0.4); this._noise(o.node, t, 0.06, 'bandpass', 3000, 2, v * 0.5); }
  }
  destroy(material, x, y, z) {
    const o = this._out(x, y, z, 120, 6, 0.8);
    if (!o) return;
    const t = this.ctx.currentTime;
    this._noise(o.node, t, 0.55, 'lowpass', material === 'metal' ? 3000 : 1600, 0.8, 0.6, 0.005, null, 180);
    this._tone(o.node, t, 0.3, 'sine', 120, 45, 0.5);
    if (material === 'metal') this._tone(o.node, t, 0.5, 'triangle', 700, 400, 0.15);
  }
  treeFall(x, y, z) {
    const o = this._out(x, y, z, 120, 6, 1.2);
    if (!o) return;
    const t = this.ctx.currentTime;
    this._noise(o.node, t, 0.9, 'lowpass', 900, 0.8, 0.5, 0.05, null, 150);
    this._tone(o.node, t + 0.3, 0.4, 'sine', 80, 40, 0.5);
  }
  explosion(x, y, z) {
    const o = this._out(x, y, z, 600, 12, 2);
    if (!o) return;
    const t = this.ctx.currentTime;
    this._noise(o.node, t, 1.6, 'lowpass', 1800, 0.7, 1.2, 0.003, this.brown, 120);
    this._tone(o.node, t, 0.8, 'sine', 80, 25, 1.0);
    this._noise(o.node, t, 0.15, 'highpass', 2000, 0.5, 0.5);
  }
  bounce(x, y, z) { const o = this._out(x, y, z, 40, 3, 0.1); if (o) this._tone(o.node, this.ctx.currentTime, 0.06, 'square', 700, 500, 0.1); }
  hitmarker(head, kill) {
    const o = this._out(null, 0, 0, 1, 1, 0.5);
    if (!o) return;
    const t = this.ctx.currentTime;
    if (head) { this._tone(o.node, t, 0.45, 'sine', 1760, 1760, 0.32); this._tone(o.node, t, 0.4, 'sine', 2640, 2640, 0.14); }
    else this._tone(o.node, t, 0.035, 'square', 2100, 1900, 0.09);
    if (kill) { this._tone(o.node, t + 0.05, 0.18, 'triangle', 880, 880, 0.25); this._tone(o.node, t + 0.16, 0.3, 'triangle', 1320, 1320, 0.25); }
  }
  shieldBreak() { const o = this._out(null, 0, 0, 1, 1, 0.5); if (o) { const t = this.ctx.currentTime; this._noise(o.node, t, 0.35, 'highpass', 3000, 1, 0.4); this._tone(o.node, t, 0.3, 'triangle', 1400, 500, 0.2); } }
  hurt(shield) {
    const o = this._out(null, 0, 0, 1, 1, 0.3);
    if (!o) return;
    const t = this.ctx.currentTime;
    if (shield) { this._tone(o.node, t, 0.12, 'triangle', 900, 600, 0.18); this._noise(o.node, t, 0.08, 'bandpass', 2500, 3, 0.2); }
    else { this._tone(o.node, t, 0.15, 'sine', 160, 70, 0.45); this._noise(o.node, t, 0.1, 'lowpass', 700, 1, 0.3); }
  }
  chestOpen(x, y, z) {
    const o = this._out(x, y, z, 60, 5, 1.2);
    if (!o) return;
    const t = this.ctx.currentTime;
    [1046, 1318, 1568, 2093].forEach((f, i) => this._tone(o.node, t + i * 0.07, 0.5, 'triangle', f, f, 0.22));
    this._noise(o.node, t, 0.6, 'highpass', 5000, 0.5, 0.15, 0.05);
    this._tone(o.node, t, 0.2, 'sine', 180, 120, 0.3);
  }
  pickup(kind) {
    const o = this._out(null, 0, 0, 1, 1, 0.3);
    if (!o) return;
    const t = this.ctx.currentTime;
    if (kind === 'weapon') { this._noise(o.node, t, 0.06, 'bandpass', 1500, 3, 0.3); this._noise(o.node, t + 0.08, 0.06, 'bandpass', 2200, 3, 0.3); }
    else { this._tone(o.node, t, 0.08, 'sine', 900, 1300, 0.16); }
  }
  heal(type, phase) {
    const o = this._out(null, 0, 0, 1, 1, 0.8);
    if (!o) return;
    const t = this.ctx.currentTime;
    if (phase === 'start') { if (type.includes('shield')) this._tone(o.node, t, 0.5, 'sine', 400, 800, 0.12, 0.05); else this._noise(o.node, t, 0.4, 'bandpass', 1200, 2, 0.15, 0.05); }
    else { const base = type.includes('shield') ? 660 : 523; [1, 1.25, 1.5].forEach((m, i) => this._tone(o.node, t + i * 0.06, 0.35, 'sine', base * m, base * m, 0.15)); }
  }
  elimination() {
    const o = this._out(null, 0, 0, 1, 1, 1);
    if (!o) return;
    const t = this.ctx.currentTime;
    this._tone(o.node, t, 0.2, 'sawtooth', 523, 523, 0.12); this._tone(o.node, t + 0.12, 0.4, 'sawtooth', 784, 784, 0.12);
    this._noise(o.node, t, 0.5, 'highpass', 6000, 0.5, 0.1, 0.05);
  }
  stormWarning() {
    const o = this._out(null, 0, 0, 1, 1, 1.5);
    if (!o) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this._tone(o.node, t + i * 0.35, 0.3, 'triangle', 330, 300, 0.18);
  }
  ui(kind) {
    if (!this.ctx) return;
    const o = this._out(null, 0, 0, 1, 1, 2.5);
    if (!o) return;
    const t = this.ctx.currentTime;
    if (kind === 'click') this._tone(o.node, t, 0.06, 'triangle', 660, 990, 0.12);
    else if (kind === 'victory') {
      [523, 659, 784, 1046].forEach((f, i) => this._tone(o.node, t + i * 0.14, 0.6, 'sawtooth', f, f, 0.1));
      [523, 659, 784].forEach((f) => this._tone(o.node, t + 0.6, 1.6, 'triangle', f, f, 0.14));
    } else if (kind === 'defeat') {
      [440, 392, 349, 294].forEach((f, i) => this._tone(o.node, t + i * 0.22, 0.6, 'triangle', f, f, 0.14));
    } else if (kind === 'bus') {
      this._tone(o.node, t, 0.3, 'square', 440, 440, 0.06); this._tone(o.node, t + 0.3, 0.4, 'square', 554, 554, 0.06);
    } else if (kind === 'jump') this._noise(o.node, t, 0.5, 'bandpass', 800, 1, 0.3, 0.05, null, 300);
    else if (kind === 'deploy') { this._noise(o.node, t, 0.35, 'lowpass', 1200, 1, 0.35); this._tone(o.node, t, 0.15, 'sine', 300, 150, 0.2); }
  }

  // ---------- loops ----------
  initLoops() {
    const c = this.ctx;
    const mk = (name, build) => {
      const g = c.createGain();
      g.gain.value = 0;
      build(g);
      g.connect(this.amb);
      this.loops[name] = g;
    };
    mk('storm', (g) => {
      const n = c.createBufferSource(); n.buffer = this.brown; n.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      n.connect(f).connect(g); n.start();
      for (const fr of [55, 82.4, 110.5]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
        const og = c.createGain(); og.gain.value = 0.05;
        const lfo = c.createOscillator(); lfo.frequency.value = 0.3 + Math.random() * 0.4;
        const lg = c.createGain(); lg.gain.value = 0.04; lfo.connect(lg).connect(og.gain); lfo.start();
        const of = c.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 300;
        o.connect(of).connect(og).connect(g); o.start();
      }
    });
    mk('wind', (g) => {
      const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.6;
      this.windFilter = f;
      n.connect(f).connect(g); n.start();
    });
    mk('bus', (g) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 62;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
      o.connect(f).connect(g); o.start();
      const n = c.createBufferSource(); n.buffer = this.brown; n.loop = true;
      const ng = c.createGain(); ng.gain.value = 0.6; n.connect(ng).connect(g); n.start();
    });
    // chest hum (spatial)
    const hum = c.createGain(); hum.gain.value = 0;
    const p = c.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 2; p.rolloffFactor = 1.4;
    this.chestPanner = p;
    for (const fr of [660, 990, 1320]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const og = c.createGain(); og.gain.value = fr === 660 ? 0.08 : 0.04;
      const lfo = c.createOscillator(); lfo.frequency.value = 5 + fr / 600;
      const lg = c.createGain(); lg.gain.value = 0.03; lfo.connect(lg).connect(og.gain); lfo.start();
      o.connect(og).connect(hum); o.start();
    }
    hum.connect(p).connect(this.amb);
    this.loops.chest = hum;
  }
  setLoop(name, level, tc = 0.3) {
    if (!this.ctx || !this.loops[name]) return;
    this.loops[name].gain.setTargetAtTime(level, this.ctx.currentTime, tc);
  }
  setWind(level) {
    this.setLoop('wind', level * 0.5, 0.2);
    if (this.windFilter) this.windFilter.frequency.setTargetAtTime(400 + level * 900, this.ctx.currentTime, 0.2);
  }
  setChest(x, y, z, level) {
    if (!this.chestPanner) return;
    const p = this.chestPanner;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    this.setLoop('chest', level * 0.9, 0.2);
  }
  stopMatchSounds() { for (const k of ['storm', 'wind', 'bus', 'chest']) this.setLoop(k, 0, 0.1); }

  // ---------- generated lobby music ----------
  playMenuMusic(on) {
    this.wantMusic = on;
    if (!this.ctx) return;
    if (on && !this.musicOn) {
      this.musicOn = true;
      this.musicStep = 0;
      this.nextNote = this.ctx.currentTime + 0.1;
      this.musicTimer = setInterval(() => this.scheduleMusic(), 50);
    } else if (!on && this.musicOn) {
      this.musicOn = false;
      clearInterval(this.musicTimer);
    }
  }
  scheduleMusic() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const bpm = 112, step = 60 / bpm / 4; // 16th notes
    const chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]; // C G Am F
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    while (this.nextNote < c.currentTime + 0.25) {
      const s = this.musicStep;
      const t = this.nextNote;
      const bar = Math.floor(s / 16) % 4;
      const ch = chords[bar];
      const pos = s % 16;
      const out = this.music;
      // kick / snare / hats
      if (pos % 4 === 0) this._tone(out, t, 0.25, 'sine', 140, 40, 0.55);
      if (pos === 4 || pos === 12) this._noise(out, t, 0.14, 'bandpass', 1800, 0.8, 0.22);
      if (pos % 2 === 1) this._noise(out, t, 0.04, 'highpass', 7000, 0.5, 0.07);
      // bass
      if (pos % 4 === 0 || pos === 6 || pos === 14) this._tone(out, t, step * 1.8, 'triangle', mtof(ch[0] - 24), null, 0.28);
      // arpeggio
      const arp = [0, 1, 2, 1, 0, 2, 1, 2];
      if (pos % 2 === 0) this._tone(out, t, step * 1.6, 'square', mtof(ch[arp[(pos / 2) % 8]] + 12), null, 0.035);
      // pad at bar start
      if (pos === 0) for (const n of ch) this._tone(out, t, step * 15, 'sawtooth', mtof(n), null, 0.025, 0.4);
      // simple melody on the last two bars
      if ((Math.floor(s / 64) % 2 === 1) && (pos === 0 || pos === 6 || pos === 10)) this._tone(out, t, step * 3, 'triangle', mtof(ch[(pos / 2) % 3] + 24), null, 0.06);
      this.nextNote += step;
      this.musicStep++;
    }
  }
}
