// Bot AI logic tests: traits / profiles, storm danger, "does it make sense" checks, judgment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../src/core/rng.js';
import { rollProfile, topTraits, behaviour, ARCHETYPES, TRAIT_KEYS } from '../src/ai/Traits.js';
import { stormThreat, zoneAt, safeAt, canPush, canBuild, judge } from '../src/ai/Tactics.js';
import { StormLogic } from '../src/match/Storm.js';
import { Inventory } from '../src/player/Inventory.js';
import { makeWeapon } from '../src/combat/Items.js';

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

test('profiles: deterministic, traits in 0..1, archetypes shift the means, individuals differ', () => {
  assert.deepEqual(rollProfile(new RNG(7)), rollProfile(new RNG(7)));
  const ids = new Set();
  for (let i = 0; i < 300; i++) {
    const p = rollProfile(new RNG(i));
    ids.add(p.persona.id);
    for (const k of TRAIT_KEYS) assert.ok(p.traits[k] >= 0 && p.traits[k] <= 1, k);
    for (const k in p.traits.weapon) assert.ok(p.traits.weapon[k] >= 0 && p.traits.weapon[k] <= 1);
  }
  assert.deepEqual([...ids].sort(), Object.keys(ARCHETYPES).sort(), 'every archetype shows up in a lobby');
  const roll = (id, n = 60) => Array.from({ length: n }, (_, i) => rollProfile(new RNG(1000 + i), id).traits);
  const builders = roll('builder'), rushers = roll('rusher'), survivors = roll('survivor');
  assert.ok(mean(builders.map((t) => t.build)) > 0.8, 'builders build');
  assert.ok(mean(rushers.map((t) => t.push)) > 0.8 && mean(rushers.map((t) => t.weapon.close)) > 0.8, 'rushers push with close guns');
  assert.ok(mean(survivors.map((t) => t.caution)) > 0.8, 'survivors are cautious');
  // two bots of the same archetype are not clones
  assert.notDeepEqual(rushers[0], rushers[1]);
  assert.ok(Math.max(...rushers.map((t) => t.push)) - Math.min(...rushers.map((t) => t.push)) > 0.15);
});

test('trait labels and behaviour mapping', () => {
  const t = rollProfile(new RNG(3), 'rusher').traits;
  const labels = topTraits(t);
  assert.ok(labels.length >= 1 && labels.length <= 2);
  // labels that only restate the archetype come last
  const tac = { ...rollProfile(new RNG(3), 'tactician').traits, utility: 0.98, build: 0.95 };
  tac.weapon = { ...tac.weapon, explosive: 0.97 };
  assert.equal(topTraits(tac, 1, 'tactician')[0], 'builds a lot');
  const hi = behaviour({ ...t, push: 1, build: 1, caution: 1, risk: 0 }), lo = behaviour({ ...t, push: 0, build: 0, caution: 0, risk: 1 });
  assert.ok(hi.rangeMul < 1 && lo.rangeMul > 1, 'push sets the preferred distance');
  assert.ok(hi.buildMul > lo.buildMul && hi.matsGoal > lo.matsGoal && hi.preBuild > 0 && lo.preBuild === 0);
  assert.ok(hi.engage < lo.engage && hi.holdChance > 0 && lo.holdChance === 0, 'caution avoids fights and hides');
  assert.ok(hi.retreatHp > lo.retreatHp, 'safe players retreat earlier');
  const sniperFan = behaviour({ ...t, weapon: { close: 0, mid: 0.5, long: 1, explosive: 0.5 } });
  assert.ok(sniperFan.weaponPref.sniper > 0 && sniperFan.weaponPref.shotgun < 0);
});

test('storm danger: outside time to death vs time to safety, shrinking zone, look-ahead', () => {
  const s = new StormLogic(new RNG(4));
  s.cur = { x: 0, z: 0, r: 100 }; s.from = { ...s.cur }; s.next = { x: 0, z: 0, r: 50 };
  s.phase = 3; s.state = 'wait'; s.timer = 10;           // phase 4: dps 5, shrink 40 s
  const inside = stormThreat(s, 50, 0, 100);
  assert.equal(inside.outside, false);
  const near = stormThreat(s, 110, 0, 100);             // 10 m out, 20 s of health
  assert.ok(near.outside && Math.abs(near.timeToDeath - 20) < 1e-9 && near.timeToSafety < 3 && !near.urgent);
  const far = stormThreat(s, 250, 0, 30);               // 150 m out, 6 s of health
  assert.ok(far.urgent);
  // while shrinking, the edge runs away from you: it takes longer to get back in
  const shrinking = Object.assign(Object.create(Object.getPrototypeOf(s)), s, { state: 'shrink', timer: 40 });
  assert.ok(stormThreat(shrinking, 150, 0, 100).timeToSafety > stormThreat(s, 150, 0, 100).timeToSafety);
  // look-ahead: the zone is 100 m now, 75 m halfway through the shrink (10 s wait + 20 s)
  assert.equal(zoneAt(s, 5).r, 100);
  assert.ok(Math.abs(zoneAt(s, 30).r - 75) < 1e-9);
  assert.ok(safeAt(s, 90, 0, 5) && !safeAt(s, 90, 0, 30), 'a spot safe now is not safe once the storm moves in');
});

test('sense checks: pushing needs a close-range gun, building needs materials', () => {
  const inv = new Inventory();
  inv.slots[0] = makeWeapon('sniper', 2); inv.ammo.heavy = 10;
  inv.slots[1] = makeWeapon('ar', 1); inv.ammo.medium = 60;
  assert.equal(canPush(inv), false, 'sniper + AR: no reason to charge in');
  inv.slots[2] = makeWeapon('shotgun', 1); inv.slots[2].mag = 0;
  assert.equal(canPush(inv), false, 'empty shotgun without shells does not count');
  inv.ammo.shells = 8;
  assert.equal(canPush(inv), true);
  assert.equal(canBuild(inv), false);
  inv.mats.wood = 9;
  assert.equal(canBuild(inv), false);
  inv.mats.brick = 30;
  assert.equal(canBuild(inv), true);
});

test('judgment: skilled bots check almost always, weak ones sometimes not - but never for good', () => {
  const rate = (j) => {
    const rng = new RNG(11), memo = new Map();
    let ok = 0, n = 0;
    for (let t = 0; t < 4000; t += 1) { n++; if (judge(memo, 'push', j, t, rng)) ok++; }
    return ok / n;
  };
  assert.ok(rate(0.97) > 0.9);
  const weak = rate(0.45);
  assert.ok(weak > 0.3 && weak < 0.6, 'weak bots skip the check a good part of the time');
  // a roll is kept for a few seconds (no flicker), then rolled again
  const rng = new RNG(5), memo = new Map();
  const first = judge(memo, 'build', 0.5, 0, rng);
  for (let t = 0; t < 4; t += 0.5) assert.equal(judge(memo, 'build', 0.5, t, rng), first);
  const seen = new Set();
  for (let t = 0; t < 400; t += 9) seen.add(judge(memo, 'build', 0.5, t, rng));
  assert.equal(seen.size, 2, 'both good and bad calls happen over time');
});
