// One battle royale match: owns the world, characters, systems, and match flow
// (bus -> drop -> play -> storm -> eliminations -> victory/defeat).
import * as THREE from 'three';
import { EventBus } from '../core/EventBus.js';
import { RNG } from '../core/rng.js';
import { DEBUG, HALF } from '../core/config.js';
import { World } from '../world/World.js';
import { Character, randomSkin } from '../player/Character.js';
import { stepMotor } from '../player/Motor.js';
import { CameraRig } from '../player/CameraRig.js';
import { PlayerController } from '../player/PlayerController.js';
import { CharacterView } from '../player/CharacterView.js';
import { Combat } from '../combat/Combat.js';
import { WEAPONS } from '../combat/Items.js';
import { BuildSystem } from '../build/BuildSystem.js';
import { StormLogic } from './Storm.js';
import { SkyBus } from './SkyBus.js';
import { Effects, StormView } from '../vfx/Effects.js';
import { HUD, escapeHtml } from '../ui/HUD.js';
import { NavGrid } from '../ai/NavGrid.js';
import { Navigator } from '../ai/Navigator.js';
import { Bot } from '../ai/Bot.js';
import { difficultyFor } from '../ai/Difficulty.js';
import { botNames } from '../ai/Names.js';
import { DebugTools, NavDebugView } from '../debug/DebugTools.js';
import { XRPlayer } from '../xr/XRPlayer.js';

const WEAPON_NAMES = { ar: 'Assault Rifle', shotgun: 'Pump Shotgun', smg: 'SMG', sniper: 'Sniper Rifle', pistol: 'Pistol', rocket: 'Rocket Launcher', grenade: 'Grenade', pickaxe: 'Pickaxe' };

export class Match {
  constructor(game, { seed, botCount, difficulty, map = {} }) {
    this.game = game;
    this.scene = game.scene;
    this.seed = seed;
    this.events = new EventBus();
    this.rng = new RNG((seed ^ 0x5bd1e995) >>> 0);
    this.time = 0;
    this.phase = 'pre';
    this.begun = false;
    this.mapOpen = false;
    this.marker = null;
    this.quality = game.quality;
    const q = this.quality;

    this.world = new World({ scene: this.scene, seed, quality: q, events: this.events, fog: game.fog, sunDir: game.sunDir, map });
    // season / biome colours for fog and background
    const th = this.world.map.theme;
    game.baseFogColor.set(th.fog);
    game.fog.color.copy(game.baseFogColor);
    game.renderer.setClearColor(th.clear);
    this.physics = this.world.physics;

    // characters
    this.chars = [];
    const names = botNames(this.rng.fork('names'), botCount);
    this.player = new Character(0, 'You', true, randomSkin(this.rng));
    this.chars.push(this.player);
    for (let i = 0; i < botCount; i++) this.chars.push(new Character(i + 1, names[i], false, randomSkin(this.rng)));
    for (const ch of this.chars) ch.visible = false;
    this.physics.chars = this.chars;
    this.aliveCount = this.chars.length;
    this.totalPlayers = this.chars.length;

    const ctx = {
      physics: this.physics, world: this.world, events: this.events, chars: this.chars, rng: this.rng.fork('combat'),
      time: () => this.time, hash: this.world.hash, shapes: this.world.shapes, hm: this.world.hm, scene: this.scene,
    };
    this.combat = new Combat(ctx);
    this.build = new BuildSystem(ctx);
    this.world.buildSystem = this.build;
    this.storm = new StormLogic(this.rng.fork('storm'), (x, z) => this.world.hm.isLand(x, z));
    this.stormView = new StormView(this.scene);
    this.bus = new SkyBus(this.scene, this.rng.fork('bus'));
    this.charView = new CharacterView(this.scene, this.chars.length + 2, q.shadows);
    this.effects = new Effects(this.scene, q.particles);
    this.effects.setPixelScale(window.innerHeight);
    this.world.loot.setPixelScale(window.innerHeight);
    this.cameraRig = new CameraRig(game.camera, this.physics, game.settings);
    this.controller = new PlayerController(this, this.player);

    this.nav = new NavGrid(this.world.hm, this.world.hash);
    this.navigator = new Navigator(this, this.nav);
    const drng = this.rng.fork('difficulty');
    this.bots = this.chars.filter((c) => c.isBot).map((ch, i) => new Bot(this, ch, difficultyFor(difficulty, i, drng), this.rng.fork('bot' + i)));
    this.hud = new HUD(this);
    this.debugTools = new DebugTools(this);
    this.navDebug = new NavDebugView(this.scene);
    this.spectateTarget = null;
    this.spectateYaw = 0;
    this.overT = 0;
    this.stormAcc = 0;
    this.wireEvents();
    this.tmpV = new THREE.Vector3();
    this.lastPhaseMsg = null;
    this.aiStats = { cover: 0, grenades: 0, breach: 0, retreats: 0, leads: 0, unstuck: 0 };
    this.xrPlayer = null;
    if (game.xr.active) this.ensureXR();
  }

  /** Create the VR player glue (match started in VR, or VR entered from the pause menu). */
  ensureXR() {
    if (!this.xrPlayer) this.xrPlayer = new XRPlayer(this);
    return this.xrPlayer;
  }

  // ---------- flow ----------
  begin() {
    this.phase = 'bus';
    this.begun = true;
    for (const ch of this.chars) {
      ch.mode = 'bus'; ch.hittable = false; ch.visible = false;
      ch.pos.x = this.bus.pos.x; ch.pos.y = this.bus.pos.y; ch.pos.z = this.bus.pos.z;
      ch.savePrev();
    }
    this.player.yaw = this.bus.yaw;
    this.player.pitch = -0.25;
    this.game.audio.setLoop('bus', 0.35);
    this.game.audio.ui('bus');
    this.hud.centerMessage('THE SKY BUS', this.game.xr.active ? 'Press A to jump · look at a controller to see its buttons' : this.game.input.touchMode ? 'Tap DROP to jump · MAP shows the route' : 'Press SPACE to jump · Tab/M to see the route', 4);
  }

  eject(ch) {
    if (ch.mode !== 'bus') return;
    ch.mode = 'freefall';
    ch.freefallT = 0;
    ch.hittable = true;
    ch.visible = true;
    ch.pos.x = this.bus.pos.x + (Math.random() - 0.5) * 3;
    ch.pos.y = this.bus.pos.y - 4;
    ch.pos.z = this.bus.pos.z + (Math.random() - 0.5) * 3;
    ch.vel.x = this.bus.dir.x * 12; ch.vel.y = -10; ch.vel.z = this.bus.dir.z * 12;
    ch.savePrev();
    if (ch === this.player) {
      this.game.audio.ui('jump');
      this.game.audio.setLoop('bus', 0.0, 1.5);
      this.game.setState('match');
    }
  }

  allowUnlocked() { return this.mapOpen || this.phase === 'over' || (!this.player.alive) || (this.debugTools && this.debugTools.open); }

  closeOverlays() {
    if (this.mapOpen) { this.toggleMap(false); return true; }
    if (this.debugTools.open) { this.debugTools.toggle(); return true; }
    if (this.controller.editPiece || this.controller.buildMode) { this.controller.cancelModes(); return true; }
    return false;
  }

  toggleMap(open) {
    this.mapOpen = open === undefined ? !this.mapOpen : open;
    this.hud.showMap(this.mapOpen);
    if (this.mapOpen) this.game.input.exitLock();
    else if (this.player.alive || this.phase === 'spectate') this.game.input.requestLock();
  }

  toggleDebugPanel() { this.debugTools.toggle(); }
  setNavDebug(on) { this.navDebug.enabled = on; if (!on) this.navDebug.clear(); }

  focusChar() {
    if (this.player.alive) return this.player;
    return this.spectateTarget && this.spectateTarget.alive ? this.spectateTarget : this.player;
  }

  nextSpectateTarget() {
    const alive = this.chars.filter((c) => c.alive && c !== this.player && c.mode !== 'bus');
    if (!alive.length) { this.spectateTarget = null; return; }
    const i = alive.indexOf(this.spectateTarget);
    this.spectateTarget = alive[(i + 1) % alive.length];
  }

  // ---------- events ----------
  wireEvents() {
    const ev = this.events, audio = this.game.audio, fx = this.effects, hud = this.hud, P = this.player;
    ev.on('shot', (e) => {
      fx.muzzleFlash(e.x, e.y, e.z, e.dx, e.dy, e.dz, e.weapon === 'shotgun' || e.weapon === 'sniper');
      audio.gun(e.weapon, e.x, e.y, e.z, e.ch === P);
      if (e.ch === P) { this.controller.addRecoil(e.recoil); this.cameraRig.addShake(e.weapon === 'shotgun' || e.weapon === 'sniper' ? 0.35 : 0.08); }
      else if (P.alive && Math.hypot(e.x - P.pos.x, e.z - P.pos.z) < 220) hud.ping(e.x, e.z);
    });
    ev.on('tracer', (e) => fx.tracer(e.x0, e.y0, e.z0, e.x1, e.y1, e.z1, e.weapon === 'sniper' ? 0xbfe6ff : 0xfff0b0, e.weapon === 'sniper' ? 0.12 : 0.07));
    ev.on('impact', (e) => {
      fx.impact(e);
      if (e.pickaxe) audio.pickaxeHit(e.surface, e.crit, e.x, e.y, e.z, e.ch === P);
      else if (e.surface !== 'flesh' && Math.random() < 0.5) audio.bulletImpact(e.surface, e.x, e.y, e.z);
    });
    ev.on('damage', (e) => {
      const fatal = e.target.health <= 0;
      if (e.attacker === P && e.target !== P) {
        hud.hitmarker(e.head, fatal);
        hud.damageNumber(e.x, e.y, e.z, e.amount, e.head, e.shieldDamage > 0);
        audio.hitmarker(e.head, fatal);
      }
      if (e.target === P) {
        if (e.attacker) hud.damageFrom(e.attacker.pos.x, e.attacker.pos.z);
        if (e.cause !== 'storm') { audio.hurt(e.shieldDamage > 0); this.cameraRig.addShake(0.25); }
        if (e.shieldDamage > 0 && P.shield <= 0) audio.shieldBreak();
      }
    });
    ev.on('death', (e) => this.onDeath(e));
    ev.on('swing', (e) => audio.swing(e.ch === P, e.ch.pos.x, e.ch.pos.y + 1, e.ch.pos.z));
    ev.on('harvest', (e) => { if (e.ch === P) hud.toast(`+${e.amount} ${e.type}${e.crit ? '  ✦' : ''}`, e.crit ? '#7ae0ff' : '#ffffff'); });
    ev.on('structDestroyed', (e) => {
      const s = this.world.surfaceOf(e.collider);
      fx.debrisBurst(e.x, e.y, e.z, s, 14, 6, 0.25);
      fx.smoke(e.x, e.y, e.z, 2.2, 1.2, 0.7, 0.45, 0.8);
      audio.destroy(s === 'wood' ? 'wood' : s === 'metal' ? 'metal' : 'brick', e.x, e.y, e.z);
      if (this.controller.editPiece && !this.controller.editPiece.alive) this.controller.cancelModes();
    });
    ev.on('buildDestroyed', (e) => {
      const s = e.material === 'wood' ? 'wood' : e.material === 'metal' ? 'metal' : 'stone';
      fx.debrisBurst(e.x, e.y, e.z, s, 16, 6, 0.28);
      fx.smoke(e.x, e.y, e.z, 2.4, 1.0, 0.75, 0.4, 0.8);
      audio.destroy(e.material, e.x, e.y, e.z);
    });
    ev.on('propDestroyed', (e) => {
      if (e.kind === 'tree') { fx.debrisBurst(e.x, e.y, e.z, 'leaf', 20, 7, 0.3); fx.debrisBurst(e.x, e.y - 2, e.z, 'wood', 10, 5, 0.25); audio.treeFall(e.x, e.y, e.z); }
      else { fx.debrisBurst(e.x, e.y, e.z, 'stone', 18, 6, 0.3); audio.destroy('brick', e.x, e.y, e.z); }
      fx.smoke(e.x, e.y, e.z, 2.5, 1.2, 0.7, 0.4, 0.8);
    });
    ev.on('built', (e) => {
      audio.build(e.piece.material, e.x, e.y, e.z, e.owner === P);
      if (e.owner === P) this.builtByPlayer = (this.builtByPlayer || 0) + 1;
    });
    ev.on('chestOpened', (e) => {
      audio.chestOpen(e.chest.x, e.chest.y + 0.5, e.chest.z);
      for (let i = 0; i < 16; i++) fx.glow(e.chest.x, e.chest.y + 0.6, e.chest.z, 0xffe080, 0.4, 0.8, (Math.random() - 0.5) * 3, Math.random() * 4, (Math.random() - 0.5) * 3, 4);
    });
    ev.on('pickup', (e) => { if (e.ch === P) { audio.pickup(e.item.kind); if (e.item.kind !== 'ammo' && e.item.kind !== 'material') hud.toast(e.name, '#fff'); } });
    ev.on('reloadStart', (e) => { if (e.ch === P) audio.reload(e.type, 'start'); });
    ev.on('reloaded', (e) => { if (e.ch === P) audio.reload(null, 'end'); });
    ev.on('useStart', (e) => { if (e.ch === P) audio.heal(e.type, 'start'); });
    ev.on('healed', (e) => { if (e.ch === P) audio.heal(e.type, 'end'); });
    ev.on('cantUse', (e) => { if (e.ch === P) hud.toast('Already full', '#ff9a7a'); });
    ev.on('dryFire', (e) => { if (e.ch === P) { audio.dry(); hud.toast('Out of ammo', '#ff7070'); } });
    ev.on('explosion', (e) => {
      fx.explosion(e.x, e.y, e.z, e.radius);
      audio.explosion(e.x, e.y, e.z);
      const d = Math.hypot(e.x - this.cameraRig.pos.x, e.y - this.cameraRig.pos.y, e.z - this.cameraRig.pos.z);
      if (d < 40) this.cameraRig.addShake(Math.min(1, 12 / Math.max(3, d)));
    });
    ev.on('bounce', (e) => audio.bounce(e.x, e.y, e.z));
    ev.on('footstep', (e) => audio.footstep(e.surface, e.ch.pos.x, e.ch.pos.y, e.ch.pos.z, e.ch === P));
    ev.on('navDirty', (e) => this.nav.updateRegion(e.minX, e.minZ, e.maxX, e.maxZ));
  }

  onDeath({ target, attacker, weapon, cause }) {
    if (!target.alive) return;
    target.alive = false;
    target.hittable = false;
    target.deathTime = this.time;
    target.placement = this.aliveCount;
    target.killer = attacker;
    target.emoting = false;
    target.useT = 0; target.reloadT = 0;
    target.anim.deathT = 0;
    this.aliveCount--;
    const items = target.inv.dropAll();
    if (target.mode === 'ground') this.world.loot.spawnBurst(items, target.pos.x, target.pos.y + 0.3, target.pos.z, 2.6);
    else this.world.loot.spawnBurst(items, target.pos.x, this.world.hm.height(target.pos.x, target.pos.z) + 0.5, target.pos.z, 2.6);
    if (attacker) attacker.stats.kills++;
    // kill feed
    const nm = (c) => `${c.persona && c.persona.icon ? `<span class="persona" title="${c.persona.name}">${c.persona.icon}</span>` : ''}<b>${escapeHtml(c.name)}</b>`;
    const was = target === this.player ? 'were' : 'was';
    let html;
    if (attacker) html = `${nm(attacker)} <span class="w">[${WEAPON_NAMES[weapon] || weapon}]</span> ${nm(target)}`;
    else if (cause === 'storm') html = `${nm(target)} ${was} lost in the storm`;
    else if (cause === 'fall') html = `${nm(target)} fell to ${target === this.player ? 'your' : 'their'} death`;
    else html = `${nm(target)} ${was} eliminated`;
    this.hud.killfeed(html, attacker === this.player || target === this.player);
    this.events.emit('eliminated', { target, attacker });
    if (attacker === this.player) {
      this.hud.centerMessage(`ELIMINATED ${escapeHtml(target.name).toUpperCase()}`, `${this.aliveCount} players left`, 2.5, 'elim');
      this.game.audio.elimination();
    }
    if (this.spectateTarget === target) {
      this.spectateTarget = attacker && attacker.alive && attacker !== this.player ? attacker : null;
      if (!this.spectateTarget) this.nextSpectateTarget();
    }
    if (target === this.player) {
      this.controller.cancelModes();
      this.phase = 'spectate';
      this.spectateTarget = attacker && attacker.alive ? attacker : null;
      if (!this.spectateTarget) this.nextSpectateTarget();
      this.hud.centerMessage(`YOU PLACED #${target.placement}`, attacker ? `Eliminated by ${escapeHtml(attacker.name)}${attacker.persona ? ` (${attacker.persona.name})` : ''}` : cause === 'storm' ? 'The storm got you' : '', 5, 'danger');
      this.game.setState('spectate');
      this.game.audio.ui('defeat');
      if (this.mapOpen) this.toggleMap(false);
    }
    if (this.aliveCount <= 1) {
      const winner = this.chars.find((c) => c.alive);
      this.winner = winner || null;
      if (winner) winner.placement = 1;
      this.endMatch();
    }
  }

  endMatch() {
    if (this.phase === 'over') return;
    const won = this.winner === this.player;
    this.phase = 'over';
    this.overT = 0;
    if (won) {
      this.hud.centerMessage('STORM CHAMPION', `#1 of ${this.totalPlayers} · ${this.player.stats.kills} eliminations`, 6, 'elim');
      this.game.audio.ui('victory');
      this.player.emoting = true;
    } else if (this.winner) {
      this.hud.centerMessage(`${escapeHtml(this.winner.name)} WINS`, 'Storm Champion', 5);
      this.spectateTarget = this.winner;
    }
  }

  buildResults() {
    const p = this.player;
    return {
      won: this.winner === p && p.alive,
      placement: p.alive ? 1 : p.placement,
      players: this.totalPlayers,
      kills: p.stats.kills,
      damage: p.stats.damage,
      time: p.stats.aliveTime,
      mats: p.stats.mats,
      accuracy: p.stats.shots ? Math.round(100 * Math.min(1, p.stats.hits / p.stats.shots)) : 0,
      built: this.builtByPlayer || 0,
      killedBy: p.killer ? p.killer.name : null,
    };
  }

  // ---------- simulation ----------
  tick(dt) {
    this.time += dt;
    const P = this.player;
    for (const ch of this.chars) ch.savePrev();

    // bus
    if (this.phase !== 'pre') this.bus.update(dt);
    const busOn = this.bus.active;
    for (const ch of this.chars) {
      if (ch.mode !== 'bus') continue;
      ch.pos.x = this.bus.pos.x; ch.pos.y = this.bus.pos.y - 2; ch.pos.z = this.bus.pos.z;
      if (!busOn) this.eject(ch);
    }
    if (P.mode === 'bus' && this.bus.canJump && this.game.input.pressed('jump')) this.eject(P);
    if (this.phase === 'bus' && !this.chars.some((c) => c.mode === 'bus')) this.phase = P.alive ? 'play' : 'spectate';

    // intents
    this.controller.tick(dt);
    const focus = this.focusChar();
    for (const b of this.bots) b.update(dt, focus);

    // movement + combat
    for (const ch of this.chars) {
      if (!ch.alive) continue;
      if (ch.mode === 'ground' || ch.mode === 'freefall' || ch.mode === 'glide') {
        const wasMode = ch.mode;
        const fall = stepMotor(ch, dt, this.physics);
        if (fall > 0) this.combat.applyDamage(ch, fall, { cause: 'fall', bypassShield: true });
        if (wasMode === 'glide' && ch.mode === 'ground' && ch === P) this.game.audio.land(true);
        if (wasMode === 'freefall' && ch.mode === 'glide' && ch === P) this.game.audio.ui('deploy');
        if (ch.mode === 'ground') {
          if (ch === P && ch.landedImpact > 9) this.game.audio.land(true);
          if (ch === P && ch.jumped) this.game.audio.jump();
          const sp = Math.hypot(ch.vel.x, ch.vel.z);
          if (ch.grounded && sp > 1.5) {
            ch.stepAcc += sp * dt;
            const stride = ch.sprinting ? 2.6 : 2.1;
            if (ch.stepAcc > stride) {
              ch.stepAcc = 0;
              if (!ch.crouching) this.events.emit('footstep', { ch, surface: this.surfaceUnder(ch), loud: ch.sprinting });
            }
          }
        }
      }
      this.combat.updateCharacter(ch, dt);
      if (ch.alive) ch.stats.aliveTime += dt;
    }
    this.combat.updateProjectiles(dt);
    this.build.update(dt);
    this.world.loot.update(dt);
    this.world.props.update(dt);

    // storm
    if (this.phase !== 'pre') {
      const ev = this.storm.update(dt);
      if (ev === 'shrinkStart') { this.hud.centerMessage('STORM IS SHRINKING', `Phase ${this.storm.phaseNumber} of ${this.storm.totalPhases}`, 3, 'storm'); this.game.audio.stormWarning(); }
      else if (ev === 'phase') this.hud.centerMessage('NEXT SAFE ZONE MARKED', `Storm shrinks in ${Math.round(this.storm.timer)}s`, 3, 'storm');
      else if (ev === 'closed') this.hud.centerMessage('THE STORM HAS CLOSED', '', 3, 'storm');
      this.stormAcc += dt;
      if (this.stormAcc >= 1) {
        this.stormAcc -= 1;
        for (const ch of this.chars) {
          if (!ch.alive || ch.mode === 'bus') continue;
          if (!this.storm.isInside(ch.pos.x, ch.pos.z)) this.combat.applyDamage(ch, this.storm.dps, { cause: 'storm', bypassShield: true });
        }
      }
    }
    this.navigator.update(2.5);

    // corpses vanish
    for (const ch of this.chars) {
      if (!ch.alive && ch.visible && this.time - ch.deathTime > 2.6) {
        ch.visible = false;
        this.effects.poof(ch.pos.x, ch.pos.y, ch.pos.z);
      }
    }
    this.debugTools.tick(dt);

    if (this.phase === 'over') {
      this.overT += dt;
      if (this.overT > (this.winner === P ? 6 : 4.5)) this.game.leaveMatch(true);
    }
    // spectate input
    if (!P.alive && this.phase !== 'over' && (this.game.input.pressed('jump') || this.game.input.mousePressed[0])) this.nextSpectateTarget();
  }

  surfaceUnder(ch) {
    if (ch.swimming) return 'water';
    if (ch.groundCollider) return this.world.surfaceOf(ch.groundCollider);
    return this.world.hm.surfaceAt(ch.pos.x, ch.pos.z);
  }

  // ---------- rendering ----------
  render(alpha, dt) {
    const game = this.game, P = this.player, cam = game.camera;
    const vr = game.xr.active && this.xrPlayer;
    if (vr) { /* head + controllers drive the view */ }
    else if (P.alive && game.input.active && !this.mapOpen && this.begun) this.controller.look(dt);
    else game.input.consumeMouse(dt);

    const lerp = (a, b) => a + (b - a) * alpha;
    if (vr) {
      this.xrPlayer.update(alpha, dt);
    } else if (P.alive && P.mode === 'bus') {
      const bx = lerp(this.bus.prev.x, this.bus.pos.x), bz = lerp(this.bus.prev.z, this.bus.pos.z);
      this.cameraRig.chase(dt, { x: bx, y: this.bus.pos.y, z: bz }, P.yaw, Math.min(0.2, P.pitch), 28);
    } else if (P.alive) {
      const a = this.controller.adsInfo();
      this.cameraRig.update(dt, { x: lerp(P.prev.x, P.pos.x), y: lerp(P.prev.y, P.pos.y), z: lerp(P.prev.z, P.pos.z), yaw: P.yaw, pitch: P.pitch, height: P.height, mode: P.mode, ads: a.ads, adsFov: a.fov, scope: a.scope });
    } else {
      const t = this.spectateTarget && this.spectateTarget.visible !== false ? this.spectateTarget : P;
      if (t !== P && t.mode !== 'bus') this.spectateYaw += (((t.yaw - this.spectateYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 3);
      this.cameraRig.update(dt, { x: lerp(t.prev.x, t.pos.x), y: lerp(t.prev.y, t.pos.y), z: lerp(t.prev.z, t.pos.z), yaw: t === P ? P.yaw : this.spectateYaw, pitch: t === P ? -0.5 : -0.25, height: t.height, mode: t === P ? 'dead' : (t.mode === 'ground' ? 'spectate' : t.mode), ads: false });
    }
    if (!vr) cam.updateMatrixWorld();
    const cp = this.cameraRig.pos, cd = this.cameraRig.dir;
    game.audio.setListener(cp.x, cp.y, cp.z, cd.x, cd.y, cd.z);

    // sun shadow follows the focus
    const f = this.focusChar();
    const sx = Math.round(f.pos.x / 4) * 4, sz = Math.round(f.pos.z / 4) * 4, sy = Math.round(f.pos.y);
    game.sun.position.set(sx + game.sunDir.x * 200, sy + game.sunDir.y * 200, sz + game.sunDir.z * 200);
    game.sun.target.position.set(sx, sy, sz);
    game.sun.target.updateMatrixWorld();

    // storm atmosphere
    const inStorm = f.alive && f.mode !== 'bus' && !this.storm.isInside(f.pos.x, f.pos.z);
    const target = inStorm ? 1 : 0;
    this.stormTint = (this.stormTint || 0) + (target - (this.stormTint || 0)) * Math.min(1, dt * 2);
    game.fog.color.copy(game.baseFogColor).lerp(new THREE.Color(0x6a3aa8), this.stormTint * 0.85);
    // high up (bus / skydiving) the island is far below: push the fog out so you can pick a landing spot
    const altitude = Math.max(0, cp.y - Math.max(0, this.world.hm.height(cp.x, cp.z)) - 25);
    const far = Math.max(game.quality.drawDist, Math.min(1400, game.quality.drawDist + altitude * 2.4));
    game.fog.near = Math.min(150, far * 0.3) * (1 - this.stormTint * 0.85);
    game.fog.far = far * (1 - this.stormTint * 0.6);
    this.world.sky.uniforms.uTint.value.set(0x5a2a90);
    this.world.sky.uniforms.uTintAmt.value = this.stormTint * 0.7;
    const edge = this.storm.distToEdge(f.pos.x, f.pos.z);
    game.audio.setLoop('storm', inStorm ? 0.9 : Math.max(0, 1 - edge / 45) * 0.45);
    const speed = Math.hypot(f.vel.x, f.vel.y, f.vel.z);
    game.audio.setWind(f.mode === 'freefall' ? Math.min(1, speed / 50) : f.mode === 'glide' ? 0.35 : 0);

    // chest hum: nearest unopened chest
    let best = null, bd = 18;
    if (P.alive && P.mode === 'ground') for (const c of this.world.loot.chests) {
      if (!c.alive || c.opened || c.kind !== 'chest') continue;
      const d = Math.hypot(c.x - P.pos.x, c.y - P.pos.y, c.z - P.pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) game.audio.setChest(best.x, best.y + 0.5, best.z, 1 - bd / 18);
    else game.audio.setLoop('chest', 0, 0.3);

    this.world.update(dt, this.time, cp, game.fog);
    this.world.render(cp);
    const hide = vr || this.cameraRig.scoped ? P : null; // VR: first person, your own body stays hidden
    this.charView.render(this.chars, alpha, cam, this.quality.charDist, hide, dt, vr ? this.cameraRig : null);
    this.effects.update(dt, this.combat.projectiles);
    this.effects.showWeakSpot(P.weakSpot && P.weakSpot.collider.alive ? P.weakSpot : null, P.alive && P.inv.sel === 0 && !this.controller.buildMode);
    this.stormView.update(this.storm, this.time);
    this.bus.render(alpha, this.time);
    if (this.navDebug.enabled) this.navDebug.update(this.nav, f, this.bots);
    // VR: the 2D HUD is invisible and only feeds the wrist panel (minimap, texts) -> 10 updates/s are plenty
    this.hudAcc = (this.hudAcc || 0) + dt;
    if (!vr || this.hudAcc >= 0.1) { this.hud.update(this.hudAcc); this.hudAcc = 0; }
    if (vr) this.xrPlayer.preRender();
    game.renderer.render(this.scene, cam);
  }

  onResize(w, h) { this.effects.setPixelScale(h); this.world.loot.setPixelScale(h); }

  debugLines() {
    const P = this.player;
    const fxc = this.effects.counts();
    const lines = [
      `seed ${this.seed}  phase ${this.phase}  time ${this.time.toFixed(0)}s  alive ${this.aliveCount}/${this.totalPlayers}`,
      `pos ${P.pos.x.toFixed(1)} ${P.pos.y.toFixed(1)} ${P.pos.z.toFixed(1)}  mode ${P.mode}  grounded ${P.grounded}  speed ${Math.hypot(P.vel.x, P.vel.z).toFixed(1)}`,
      `colliders ${this.world.hash.count}  builds ${this.build.count}  loot ${this.world.loot.items.filter((i) => i.alive).length}  chests ${this.world.loot.chests.filter((c) => c.alive && !c.opened).length}  projectiles ${this.combat.projectiles.length}`,
      `fx debris ${fxc.debris} glow ${fxc.glows} smoke ${fxc.smoke} tracers ${fxc.tracers}  rays ${this.physics.stats.rays}`,
      `nav: queue ${this.navigator.queue.length}  solved ${this.navigator.stats.solved}  cache hits ${this.navigator.stats.cacheHits}  ${this.navigator.stats.lastMs.toFixed(2)} ms/frame  AI ${this.botMs ? this.botMs.toFixed(2) : 0} ms`,
      `storm phase ${this.storm.phaseNumber} ${this.storm.state} r=${this.storm.cur.r.toFixed(0)} t=${this.storm.timer.toFixed(0)}`,
    ];
    this.physics.stats.rays = 0;
    const states = {};
    for (const b of this.bots) if (b.ch.alive) states[b.state] = (states[b.state] || 0) + 1;
    lines.push(`AI tactics: cover ${this.aiStats.cover} grenades ${this.aiStats.grenades} breach shots ${this.aiStats.breach} retreats ${this.aiStats.retreats} unstuck ${this.aiStats.unstuck}`);
    lines.push('bot states: ' + Object.entries(states).map(([k, v]) => `${k}:${v}`).join(' '));
    // selected bot: nearest to the crosshair
    let sel = null, bestA = 0.25;
    const cp = this.cameraRig.pos, cd = this.cameraRig.dir;
    for (const b of this.bots) {
      if (!b.ch.alive || !b.ch.visible) continue;
      const dx = b.ch.pos.x - cp.x, dy = b.ch.pos.y + 1 - cp.y, dz = b.ch.pos.z - cp.z;
      const d = Math.hypot(dx, dy, dz);
      const a = Math.acos(Math.max(-1, Math.min(1, (dx * cd.x + dy * cd.y + dz * cd.z) / d)));
      if (a < bestA && d < 300) { bestA = a; sel = b; }
    }
    if (sel) lines.push(...sel.debugInfo());
    return lines;
  }

  dispose() {
    if (this.xrPlayer) { this.xrPlayer.dispose(); this.xrPlayer = null; }
    this.events.clear();
    this.hud.dispose();
    this.debugTools.dispose();
    this.navDebug.dispose();
    this.build.clear();
    this.combat.clear();
    this.charView.dispose();
    this.effects.dispose();
    this.stormView.dispose();
    this.bus.dispose();
    this.world.dispose();
    this.game.baseFogColor.set(0xa9cdee);
    this.game.renderer.setClearColor(0x87b8e8);
    this.game.fog.color.copy(this.game.baseFogColor);
    this.game.applyQuality();
    this.game.camera.fov = this.game.settings.get('fov');
    this.game.camera.updateProjectionMatrix();
  }
}
