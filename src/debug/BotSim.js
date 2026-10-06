// Headless bot simulation for tuning the AI (dev tool, not loaded by the game).
// In the browser console of a running page:
//   const { BotSim } = await import('/src/debug/BotSim.js');
//   const sim = await BotSim.start(window.__game, { bots: 49 }); // starts a match, stops rendering
//   sim.run(60 * 60);                                 // simulate 60 s (call repeatedly)
//   sim.report();                                     // storm / behaviour statistics
// The player is invisible and invulnerable, so the lobby is bots only.

export class BotSim {
  static async start(game, { stormSpeed = 1, bots = null, seed = null } = {}) {
    const prev = { botCount: game.settings.get('botCount'), seed: game.settings.get('seed') };
    if (bots) game.settings.set('botCount', bots);
    if (seed !== null) game.settings.set('seed', String(seed));
    game.startMatch();
    game.settings.set('botCount', prev.botCount); game.settings.set('seed', prev.seed);
    await new Promise((r) => setTimeout(r, 2500));
    game.renderer.setAnimationLoop(null);
    const sim = new BotSim(game);
    sim.m.storm.speed = stormSpeed;
    return sim;
  }

  constructor(game) {
    const m = this.m = game.match;
    m.allowUnlocked = () => true;
    if (!m.begun) m.begin();
    m.player.god = true;
    this.t = 0;
    this.idle = {};              // seconds spent outside the zone, by bot state (rotate excluded)
    this.idleBots = new Map();
    this.stormDeaths = [];
    this.deaths = 0;
    this.builds = new Map();
    this.fightDist = [];         // [bot, weapon, distance] samples while fighting
    this.stateTime = new Map();  // bot -> { state: seconds }
    this.engaged = new Map();    // bot -> fights started
    this.stuckOutside = {};      // seconds outside the zone barely moving (< 1 m/s), by state
    this.prevPos = new Map();
    this.stuckLog = [];
    m.events.on('death', (e) => {
      this.deaths++;
      if (e.cause !== 'storm') return;
      const b = m.bots.find((x) => x.ch === e.target);
      if (b) this.stormDeaths.push(`${b.lastState || b.state}/${b.ch.persona.id}/${b.d.name} phase ${m.storm.phaseNumber}${m.storm.state === "done" || m.storm.next.r === 0 ? " (final circle)" : ""} alive ${m.aliveCount}`);
    });
    m.events.on('built', (e) => { if (e.owner) this.builds.set(e.owner, (this.builds.get(e.owner) || 0) + 1); });
  }

  run(ticks) {
    const m = this.m, P = m.player, t0 = performance.now();
    for (let i = 0; i < ticks; i++) {
      P.hittable = false; P.god = true;
      for (const b of m.bots) if (b.ch.alive) { if (b.state === 'fight' && b.lastState !== 'fight') this.engaged.set(b, (this.engaged.get(b) || 0) + 1); b.lastState = b.state; }
      m.tick(1 / 60);
      this.t++;
      if (this.t % 30 === 0) this.sample(0.5);
      if (m.phase === 'over' || m.aliveCount <= 1) break;
    }
    return { simSec: Math.round(this.t / 60), ms: Math.round(performance.now() - t0), alive: m.aliveCount, phase: m.phase, storm: `${m.storm.phaseNumber} ${m.storm.state}` };
  }

  sample(dt) {
    const m = this.m;
    for (const b of m.bots) {
      const ch = b.ch;
      if (!ch.alive || ch.mode !== 'ground') continue;
      const st = this.stateTime.get(b) || {};
      st[b.state] = (st[b.state] || 0) + dt;
      this.stateTime.set(b, st);
      const pp = this.prevPos.get(b), moved = pp ? Math.hypot(ch.pos.x - pp.x, ch.pos.z - pp.z) : 99;
      this.prevPos.set(b, { x: ch.pos.x, z: ch.pos.z });
      if (!m.storm.isInside(ch.pos.x, ch.pos.z)) {
        if (b.state !== 'rotate') {
          this.idle[b.state] = (this.idle[b.state] || 0) + dt;
          this.idleBots.set(b, (this.idleBots.get(b) || 0) + dt);
        }
        if (moved < dt * 1) {
          this.stuckOutside[b.state] = (this.stuckOutside[b.state] || 0) + dt;
          if (this.stuckLog.length < 16 && Math.random() < 0.08) this.stuckLog.push(`${b.state} ${ch.name} at ${ch.pos.x.toFixed(0)},${ch.pos.y.toFixed(1)},${ch.pos.z.toFixed(0)} path=${b.path ? b.pathIdx + '/' + b.path.points.length : '-'} chain=${b.chain ? 1 : 0}/${b.exitChain ? 1 : 0} stuck=${b.stuckLevel} grounded=${ch.grounded} blocked=${ch.blocked} water=${m.world.hm.height(ch.pos.x, ch.pos.z) < 0} use=${ch.useT > 0} hp=${Math.round(ch.health)}`);
        }
      }
      if (b.state === 'fight' && b.target && b.canSeeRecently()) {
        const cur = ch.inv.current();
        this.fightDist.push([b, cur && cur.kind === 'weapon' ? cur.type : 'pickaxe', Math.hypot(b.target.pos.x - ch.pos.x, b.target.pos.z - ch.pos.z)]);
      }
    }
  }

  /** Averages of a per-bot number for bots whose trait `key` is high (> 0.65) vs low (< 0.35). */
  byTrait(key, fn) {
    const hi = [], lo = [];
    for (const b of this.m.bots) {
      const v = b.t ? b.t[key] : undefined;
      if (v === undefined) continue;
      const x = fn(b);
      if (x === null || x === undefined || Number.isNaN(x)) continue;
      if (v > 0.65) hi.push(x); else if (v < 0.35) lo.push(x);
    }
    const avg = (a) => (a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null);
    return { high: avg(hi), low: avg(lo), n: `${hi.length}/${lo.length}` };
  }

  report() {
    const m = this.m;
    const r1 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    const worst = [...this.idleBots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([b, n]) => `${b.ch.persona.id}/${b.d.name}/${b.lastState}:${Math.round(n)}s${b.ch.alive ? '' : ' (dead)'}`);
    const out = {
      simSec: Math.round(this.t / 60), alive: m.aliveCount, deaths: this.deaths,
      stormDeaths: this.stormDeaths.length, stormDeathStates: this.stormDeaths,
      outsideZoneNotRotatingSec: r1(this.idle), worstOutside: worst, outsideBarelyMovingSec: r1(this.stuckOutside), stuckSamples: this.stuckLog, aiStats: m.aiStats,
    };
    if (m.bots[0] && m.bots[0].t) {
      const time = (b, s) => (this.stateTime.get(b) || {})[s] || 0;
      const dist = (b, types) => { const a = this.fightDist.filter(([x, w]) => x === b && types.includes(w)).map((e) => e[2]); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
      out.traits = {
        buildsPerBot: this.byTrait('build', (b) => this.builds.get(b.ch) || 0),
        holdSec: this.byTrait('caution', (b) => time(b, 'hold')),
        fightsStarted: this.byTrait('caution', (b) => this.engaged.get(b) || 0),
        pushDistCloseGun: this.byTrait('push', (b) => dist(b, ['shotgun', 'smg'])),
        pushDistLongGun: this.byTrait('push', (b) => dist(b, ['sniper', 'ar'])),
        lootSec: this.byTrait('greed', (b) => time(b, 'loot')),
      };
    }
    return out;
  }
}
