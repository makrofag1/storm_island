// Logic tests (no browser / three.js needed): node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RNG, hashString, resolveSeed } from '../src/core/rng.js';
import { Heightmap } from '../src/world/Heightmap.js';
import { applyDamageToStats, hitDamage, falloffMul, canUseConsumable, applyConsumable } from '../src/combat/Damage.js';
import { WEAPONS, CONSUMABLES, rollLoot } from '../src/combat/Items.js';
import { StormLogic, STORM_PHASES, INITIAL_RADIUS } from '../src/match/Storm.js';
import { NavGrid } from '../src/ai/NavGrid.js';
import { SpatialHash, makeCollider, C_BOX, C_RAMP, surfaceY } from '../src/world/Colliders.js';
import { pieceKey, pieceBounds, tileBounds, wallSlotFacing, dirFromVector, levelAt, boundsOverlap } from '../src/build/grid.js';
import { Inventory } from '../src/player/Inventory.js';
import { prettyRenderer, classifyRenderer } from '../src/core/gpu.js';
import { DIFFICULTIES, difficultyFor } from '../src/ai/Difficulty.js';
import { resolveMapOptions, MAP_OPTIONS } from '../src/world/MapOptions.js';

// ---------- seeds / RNG ----------
test('RNG is deterministic for a seed and differs across seeds', () => {
  const a = new RNG(1234), b = new RNG(1234), c = new RNG(999);
  const sa = Array.from({ length: 20 }, () => a.next());
  const sb = Array.from({ length: 20 }, () => b.next());
  const sc = Array.from({ length: 20 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test('string seeds hash consistently; numeric strings stay numeric', () => {
  assert.equal(hashString('storm'), hashString('storm'));
  assert.notEqual(hashString('storm'), hashString('island'));
  assert.equal(resolveSeed('42'), 42);
  assert.equal(resolveSeed('island'), hashString('island'));
  assert.equal(new RNG('abc').fork('x').next(), new RNG('abc').fork('x').next());
});

test('heightmap generation is deterministic and forms an island', () => {
  const h1 = new Heightmap(new RNG(77)), h2 = new Heightmap(new RNG(77));
  assert.equal(h1.data.length, h2.data.length);
  for (let i = 0; i < h1.data.length; i += 997) assert.equal(h1.data[i], h2.data[i]);
  assert.ok(h1.height(0, 0) > 0, 'center is land');
  assert.ok(h1.height(760, 760) < 0, 'corner is ocean');
  assert.ok(h1.maxH > 60, 'has a mountain');
});

// ---------- damage / shield ----------
test('shield absorbs damage before health', () => {
  const s = { health: 100, shield: 50 };
  const r = applyDamageToStats(s, 70);
  assert.equal(s.shield, 0);
  assert.equal(s.health, 80);
  assert.equal(r.shieldDamage, 50);
  assert.equal(r.healthDamage, 20);
  assert.equal(r.dead, false);
});

test('storm/fall damage bypasses shield and death is reported', () => {
  const s = { health: 10, shield: 100 };
  const r = applyDamageToStats(s, 25, true);
  assert.equal(s.shield, 100);
  assert.equal(s.health, 0);
  assert.equal(r.dead, true);
});

test('headshots, rarity and falloff scale weapon damage', () => {
  const ar = WEAPONS.ar;
  const body = hitDamage(ar, 0, 10, false);
  assert.equal(body, ar.damage);
  assert.equal(hitDamage(ar, 0, 10, true), ar.damage * ar.head);
  assert.ok(hitDamage(ar, 4, 10, false) > body, 'legendary hits harder');
  assert.ok(hitDamage(ar, 0, 300, false) < body, 'long range falloff');
  assert.equal(falloffMul(ar, ar.falloff[1] + 50), ar.falloff[2]);
});

test('healing respects caps', () => {
  const s = { health: 70, shield: 40 };
  assert.ok(applyConsumable(s, CONSUMABLES.bandage));
  assert.equal(s.health, 75);
  assert.equal(canUseConsumable(s, CONSUMABLES.bandage), false);
  assert.ok(applyConsumable(s, CONSUMABLES.smallshield));
  assert.equal(s.shield, 50);
  assert.equal(canUseConsumable(s, CONSUMABLES.smallshield), false);
  assert.ok(applyConsumable(s, CONSUMABLES.bigshield));
  assert.equal(s.shield, 100);
  assert.ok(applyConsumable(s, CONSUMABLES.medkit));
  assert.equal(s.health, 100);
});

test('loot tables always produce valid items', () => {
  const rng = new RNG(5);
  for (let i = 0; i < 300; i++) {
    for (const src of ['floor', 'chest', 'ammobox']) {
      for (const it of rollLoot(rng, src)) {
        assert.ok(['weapon', 'ammo', 'consumable', 'material'].includes(it.kind));
        if (it.kind === 'weapon') assert.ok(WEAPONS[it.type].rarities.includes(it.rarity));
      }
    }
  }
});

test('inventory stacks consumables and swaps when full', () => {
  const inv = new Inventory();
  inv.add({ kind: 'consumable', type: 'bandage', count: 10 });
  inv.add({ kind: 'consumable', type: 'bandage', count: 10 });
  assert.equal(inv.count('bandage'), 20);
  for (let i = 0; i < 3; i++) inv.add({ kind: 'weapon', type: 'ar', rarity: i, mag: 30 });
  assert.equal(inv.firstEmpty(), -1);
  inv.sel = 3;
  const res = inv.add({ kind: 'weapon', type: 'sniper', rarity: 4, mag: 1 });
  assert.equal(res.taken, true);
  assert.equal(res.dropped.type, 'ar');
  assert.equal(inv.slots[2].type, 'sniper');
  inv.add({ kind: 'ammo', type: 'heavy', count: 500 });
  assert.equal(inv.ammo.heavy, 60, 'ammo capped');
});

// ---------- storm ----------
test('storm runs all phases, each circle inside the previous one, then closes', () => {
  const s = new StormLogic(new RNG(3));
  assert.equal(s.cur.r, INITIAL_RADIUS);
  let prev = { ...s.next };
  let phases = 0, closed = false;
  for (let t = 0; t < 2000 && !closed; t++) {
    const ev = s.update(1);
    if (ev === 'phase') {
      phases++;
      const d = Math.hypot(s.next.x - prev.x, s.next.z - prev.z);
      assert.ok(d + s.next.r <= prev.r + 1e-6, 'next circle inside current');
      prev = { ...s.next };
    }
    if (ev === 'closed') closed = true;
  }
  assert.ok(closed);
  assert.equal(phases, STORM_PHASES.length - 1);
  assert.equal(s.cur.r, 0);
  assert.ok(STORM_PHASES.length >= 7 && STORM_PHASES.length <= 8);
  assert.ok(STORM_PHASES[STORM_PHASES.length - 1].dps > STORM_PHASES[0].dps, 'damage grows');
});

test('storm shrink interpolates radius', () => {
  const s = new StormLogic(new RNG(9));
  s.update(STORM_PHASES[0].wait + 0.001);
  assert.equal(s.state, 'shrink');
  s.update(STORM_PHASES[0].shrink / 2);
  assert.ok(s.cur.r < INITIAL_RADIUS && s.cur.r > STORM_PHASES[0].radius);
  assert.ok(s.isInside(s.next.x, s.next.z));
});

// ---------- A* nav grid ----------
function flatGrid() {
  const hm = { height: () => 5 };
  const hash = new SpatialHash(8);
  return { nav: new NavGrid(hm, hash, { size: 200, cell: 2 }), hash };
}

test('A* finds a straight path on open ground', () => {
  const { nav } = flatGrid();
  const r = nav.findPath(-50, 0, 50, 0);
  assert.ok(r && r.complete);
  const last = r.points[r.points.length - 1];
  assert.equal(last.x, 50); assert.equal(last.z, 0);
  assert.ok(r.points.length <= 2, 'smoothed to a straight line');
});

test('A* routes around a wall through the gap', () => {
  const { nav, hash } = flatGrid();
  // wall along z = 0 from x=-60..60 with a gap at x in [20, 26]
  for (const [a, b] of [[-60, 20], [26, 60]]) {
    const c = makeCollider(C_BOX, a, 0, -0.5, b, 20, 0.5);
    hash.insert(c);
    nav.markCollider(c);
  }
  const r = nav.findPath(0, -20, 0, 20);
  assert.ok(r && r.complete);
  assert.ok(r.points.some((p) => p.x > 18 && p.x < 28 && Math.abs(p.z) < 6), 'passes through the gap');
  for (const p of r.points) assert.ok(nav.walkableAt(p.x, p.z));
});

test('A* returns a partial path when the goal is enclosed', () => {
  const { nav, hash } = flatGrid();
  for (const c of [makeCollider(C_BOX, 30, 0, 30, 50, 9, 31), makeCollider(C_BOX, 30, 0, 49, 50, 9, 50), makeCollider(C_BOX, 30, 0, 30, 31, 9, 50), makeCollider(C_BOX, 49, 0, 30, 50, 9, 50)]) { hash.insert(c); nav.markCollider(c); }
  const r = nav.findPath(-40, -40, 40, 40, 20000);
  assert.ok(r);
  assert.equal(r.complete, false);
});

test('ramp collider surface rises along its direction', () => {
  const c = makeCollider(C_RAMP, 0, 0, 0, 4, 3, 4, null, 0);
  assert.equal(surfaceY(c, 0, 2), 0);
  assert.equal(surfaceY(c, 4, 2), 3);
  assert.equal(surfaceY(c, 2, 2), 1.5);
});

// ---------- build grid ----------
test('build grid keys and bounds', () => {
  assert.equal(pieceKey('wall', 1, 2, 0, 'x'), 'w:x:1:2:0');
  assert.equal(pieceKey('stairs', 1, 2, 3), pieceKey('roof', 1, 2, 3), 'stairs and roof share the center slot');
  const f = pieceBounds('floor', 2, -1, 1);
  assert.deepEqual([f.minX, f.maxX, f.minZ, f.maxZ, f.maxY], [8, 12, -4, 0, 3]);
  const w = pieceBounds('wall', 0, 0, 0, 'z');
  assert.ok(w.maxX - w.minX < 0.5 && w.maxZ - w.minZ === 4 && w.maxY - w.minY === 3);
  const t = tileBounds('wall', 0, 0, 0, 'x', 2, 1);
  assert.ok(Math.abs(t.minX - 8 / 3) < 1e-9 && t.minY === 1 && t.maxY === 2);
});

test('wall slot facing / direction / level helpers', () => {
  assert.deepEqual(wallSlotFacing(3, 4, 0), { ix: 4, iz: 4, axis: 'z' });
  assert.deepEqual(wallSlotFacing(3, 4, 3), { ix: 3, iz: 4, axis: 'x' });
  assert.equal(dirFromVector(1, 0.2), 0);
  assert.equal(dirFromVector(-0.1, -1), 3);
  assert.equal(levelAt(2.9), 1);
  assert.equal(levelAt(2.5), 0);
  const a = pieceBounds('floor', 0, 0, 1), b = pieceBounds('wall', 0, 0, 1, 'x');
  assert.ok(boundsOverlap(a, b, 0.2), 'floor and its edge wall are neighbors');
});

// ---------- GPU detection ----------
test('GPU renderer strings are parsed and classified', () => {
  const nv = 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 (0x00001C8D) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const intel = 'ANGLE (Intel, Intel(R) HD Graphics 630 (0x0000591B) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  assert.equal(prettyRenderer(nv), 'NVIDIA GeForce GTX 1050');
  assert.equal(prettyRenderer(intel), 'Intel(R) HD Graphics 630');
  assert.equal(classifyRenderer(nv), 'discrete');
  assert.equal(classifyRenderer(intel), 'integrated');
  assert.equal(classifyRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'), 'software');
});

// ---------- bot personalities ----------
// ---------- map options / difficulty ----------
test('map options resolve deterministically and change the terrain', () => {
  const a = resolveMapOptions({ mapTheme: 'random', mapWater: 'random' }, new RNG(5));
  const b = resolveMapOptions({ mapTheme: 'random', mapWater: 'random' }, new RNG(5));
  assert.equal(a.mapTheme, b.mapTheme);
  assert.ok(MAP_OPTIONS.mapTheme.values.some((v) => v[0] === a.mapTheme));
  const flat = new Heightmap(new RNG(9), resolveMapOptions({ mapTerrain: 'flat', mapWater: 'dry' }, new RNG(9)));
  const tall = new Heightmap(new RNG(9), resolveMapOptions({ mapTerrain: 'mountains', mapWater: 'dry' }, new RNG(9)));
  assert.ok(tall.maxH > flat.maxH + 10, 'mountains are higher than flat terrain');
  const small = resolveMapOptions({ mapSize: 'small' }, new RNG(1)), large = resolveMapOptions({ mapSize: 'large' }, new RNG(1));
  const land = (map) => { const hm = new Heightmap(new RNG(3), map); let n = 0; for (let x = -700; x <= 700; x += 20) for (let z = -700; z <= 700; z += 20) if (hm.isLand(x, z)) n++; return n; };
  assert.ok(land(large) > land(small) * 1.3, 'large islands have more land');
  const isl = new Heightmap(new RNG(3), resolveMapOptions({ mapWater: 'islands' }, new RNG(3)));
  const dry = new Heightmap(new RNG(3), resolveMapOptions({ mapWater: 'dry' }, new RNG(3)));
  let water = 0, waterDry = 0;
  for (let x = -400; x <= 400; x += 8) for (let z = -400; z <= 400; z += 8) { if (isl.height(x, z) < 0) water++; if (dry.height(x, z) < 0) waterDry++; }
  assert.ok(water > waterDry, 'archipelago cuts sea channels into the island');
});

test('difficulty presets get strictly harder', () => {
  const order = ['easy', 'medium', 'hard', 'expert'].map((k) => DIFFICULTIES[k]);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i].aimError < order[i - 1].aimError && order[i].reaction < order[i - 1].reaction);
    assert.ok(order[i].engage >= order[i - 1].engage);
    assert.ok(order[i].judgment > order[i - 1].judgment && order[i].awareness > order[i - 1].awareness, 'better decisions on harder levels');
  }
  assert.equal(difficultyFor('expert', 0, new RNG(1)).name, 'expert');
});
