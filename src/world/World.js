// World aggregate: generates the island (data + views) and routes damage to destructibles.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { HALF } from '../core/config.js';
import { Heightmap } from './Heightmap.js';
import { SpatialHash } from './Colliders.js';
import { Physics } from './Physics.js';
import { ShapeBatches, Structures, DecorBatch } from './Structures.js';
import { WorldGen } from './WorldGen.js';
import { TerrainView, WaterView, SkyView } from './TerrainView.js';
import { Props, Grass } from './Props.js';
import { Loot } from './Loot.js';
import { resolveMapOptions } from './MapOptions.js';

export const HARVEST = { tree: ['wood', 7], rock: ['brick', 6], wood: ['wood', 5], brick: ['brick', 4], metal: ['metal', 4] };

export class World {
  constructor({ scene, seed, quality, events, fog, sunDir, map = {} }) {
    const t0 = performance.now();
    this.scene = scene;
    this.events = events;
    this.seed = seed;
    this.rng = new RNG(seed);
    this.map = resolveMapOptions(map, this.rng);
    this.root = new THREE.Group();
    this.root.name = 'world';
    scene.add(this.root);
    this.hm = new Heightmap(this.rng, this.map);
    this.hash = new SpatialHash(8);
    this.shapes = new ShapeBatches(this.root, quality.shadows);
    this.structures = new Structures(this.hash, this.shapes, events);
    this.decor = new DecorBatch();
    this.gen = new WorldGen(this.hm, this.structures, this.decor, this.rng, this.map);
    this.gen.generate();
    this.pois = this.gen.pois;
    this.sites = this.gen.sites;
    this.buildings = this.gen.buildings;
    this.lootSpots = this.gen.loot;
    this.chestSpots = this.gen.chests;
    this.ammoSpots = this.gen.ammo;
    this.terrain = new TerrainView(this.hm, quality.terrainRes, this.root);
    this.water = new WaterView(this.hm, this.root, fog, this.map.theme);
    this.sky = new SkyView(this.root, sunDir, this.map.theme);
    this.props = new Props(this.root, this.hash, events, this.gen.propPlacement(), quality.shadows, this.map.theme);
    this.decor.build(this.root, quality.shadows);
    this.physics = new Physics(this.hm, this.hash);
    this.loot = new Loot(this.root, this.physics, events, this.rng.fork('loot'));
    this.loot.populate(this);
    this.buildSystem = null; // set by match

    // occupancy (4m cells) of building footprints - used to keep grass out of interiors
    this.occN = Math.ceil((HALF * 2) / 4);
    this.occ = new Uint8Array(this.occN * this.occN);
    for (const b of this.buildings) {
      for (let z = b.minZ; z < b.maxZ; z += 2) for (let x = b.minX; x < b.maxX; x += 2) {
        const i = Math.floor((x + HALF) / 4), j = Math.floor((z + HALF) / 4);
        if (i >= 0 && j >= 0 && i < this.occN && j < this.occN) this.occ[j * this.occN + i] = 1;
      }
    }
    this.grass = new Grass(this.root, this.hm, Math.round(quality.grass * this.map.theme.grassMul), (x, z) => this.isIndoors(x, z), { range: quality.grassRange, wind: quality.wind, colors: this.map.theme.grass });
    this.genTime = performance.now() - t0;
  }

  isIndoors(x, z) {
    const i = Math.floor((x + HALF) / 4), j = Math.floor((z + HALF) / 4);
    if (i < 0 || j < 0 || i >= this.occN || j >= this.occN) return false;
    return this.occ[j * this.occN + i] === 1;
  }

  surfaceOf(collider) {
    const o = collider && collider.owner;
    if (!o) return 'stone';
    if (o.kind === 'tree') return 'wood';
    if (o.kind === 'rock') return 'stone';
    const m = o.mat;
    return m === 'wood' ? 'wood' : m === 'metal' ? 'metal' : 'stone';
  }

  /**
   * Damage whatever owns a collider. opts: { pickaxe, crit, attacker }
   * Returns { destroyed, harvest: {type, amount} | null, surface } or null if indestructible.
   */
  damageCollider(c, amount, opts = {}) {
    const o = c.owner;
    if (!o) return null;
    let destroyed = false, harvest = null;
    const surface = this.surfaceOf(c);
    if (o.kind === 'tree' || o.kind === 'rock') {
      destroyed = this.props.damage(o, amount);
      if (opts.pickaxe) {
        const [type, base] = HARVEST[o.kind];
        harvest = { type, amount: Math.round(base * (opts.crit ? 2 : 1) * (0.85 + Math.random() * 0.3)) + (destroyed ? 6 : 0) };
      }
    } else if (o.kind === 'struct') {
      if (!o.breakable) return { destroyed: false, harvest: null, surface };
      destroyed = this.structures.damage(o, amount);
      if (opts.pickaxe) {
        const [type, base] = HARVEST[o.mat];
        harvest = { type, amount: Math.round(base * (opts.crit ? 2 : 1)) + (destroyed ? 4 : 0) };
      }
    } else if (o.kind === 'build') {
      if (this.buildSystem) destroyed = this.buildSystem.damagePiece(o, amount, opts.attacker);
      return { destroyed, harvest: null, surface: o.material === 'wood' ? 'wood' : o.material === 'metal' ? 'metal' : 'stone' };
    }
    return { destroyed, harvest, surface };
  }

  update(dt, time, camPos, fog) {
    this.props.update(dt);
    this.loot.update(dt);
    this.water.update(time, fog);
    this.sky.update(camPos);
    this.grass.update(camPos.x, camPos.z, time);
  }

  render(camPos) {
    this.loot.render(camPos);
    this.shapes.flush();
  }

  dispose() {
    this.terrain.dispose();
    this.water.dispose();
    this.sky.dispose();
    this.props.dispose();
    this.decor.dispose();
    this.loot.dispose();
    this.grass.dispose();
    this.shapes.dispose();
    this.root.removeFromParent();
    this.hash.clear();
  }
}
