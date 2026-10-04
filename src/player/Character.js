// Character state shared by the player and bots (simulation data only; rendering is in CharacterView).
import { CHAR_RADIUS, CHAR_HEIGHT } from '../core/config.js';
import { Inventory } from './Inventory.js';

export function makeIntent() {
  return {
    mx: 0, mz: 0,             // desired move direction in world XZ (length <= 1)
    sprint: false, jump: false, crouch: false,
    fire: false, firePressed: false, aim: false,
    reload: false, interact: false,
    dive: false, slow: false, // freefall / glide modifiers
    emote: false,
  };
}

const SKIN_COLORS = [0xf2c9a0, 0xe0ac7e, 0xc68642, 0x8d5524, 0xffdbac, 0xb07a52];
const OUTFIT = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0x34495e, 0xff6fb5, 0x7f8c8d, 0xffffff, 0x222831, 0x8e44ad, 0x16a085, 0xd35400, 0x2c3e50];

export function randomSkin(rng) {
  return {
    skin: rng.pick(SKIN_COLORS),
    shirt: rng.pick(OUTFIT),
    pants: rng.pick(OUTFIT),
    pack: rng.pick(OUTFIT),
    hat: rng.int(-1, 3),         // -1 = none
    hatColor: rng.pick(OUTFIT),
    glider: rng.pick(OUTFIT),
  };
}

export class Character {
  constructor(id, name, isPlayer, skin) {
    this.id = id;
    this.name = name;
    this.isPlayer = isPlayer;
    this.isBot = !isPlayer;
    this.skin = skin;
    this.pos = { x: 0, y: 0, z: 0 };
    this.prev = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.prevYaw = 0; this.pitch = 0;
    this.radius = CHAR_RADIUS;
    this.height = CHAR_HEIGHT;
    this.crouching = false;
    this.sprinting = false;
    this.mode = 'bus';
    this.grounded = false;
    this.swimming = false;
    this.groundCollider = null;
    this.freefallT = 0;
    this.health = 100;
    this.shield = 0;
    this.alive = true;
    this.hittable = false;
    this.inv = new Inventory();
    this.intent = makeIntent();
    // combat
    this.fireCd = 0; this.bloom = 0;
    this.reloadT = 0; this.reloadTotal = 0;
    this.useT = 0; this.useTotal = 0; this.useSlot = -1;
    this.swingCd = 0; this.swingAnim = 0;
    this.lastSel = 0;
    this.lastDamageT = -99; this.lastAttacker = null; this.lastShotT = -99;
    this.stats = { kills: 0, damage: 0, damageTaken: 0, mats: 0, shots: 0, hits: 0, headshots: 0, aliveTime: 0, chests: 0 };
    this.anim = { phase: 0, speed: 0, fire: 0, hit: 0, deathT: 0, emoteT: 0, land: 0 };
    this.placement = 0;
    this.killer = null;
    this.deathTime = 0;
    this.emoting = false;
    this.landedImpact = 0;
    this.stepAcc = 0;
  }
  get eyeY() { return this.pos.y + this.height - 0.22; }
  savePrev() {
    this.prev.x = this.pos.x; this.prev.y = this.pos.y; this.prev.z = this.pos.z;
    this.prevYaw = this.yaw;
  }
  hpTotal() { return this.health + this.shield; }
}
