// Shared loot interactions (player and bots): pick up, auto-pickup, chest opening.
import { itemName } from '../combat/Items.js';

const near = [];

export function tryPickup(match, ch, it) {
  if (!it.alive) return false;
  const res = ch.inv.add(it.item, true);
  if (!res.taken) return false;
  const loot = match.world.loot;
  loot.remove(it);
  if (res.rest) loot.spawn(res.rest, it.x, it.y, it.z);
  if (res.dropped) loot.spawn(res.dropped, ch.pos.x, ch.pos.y + 0.05, ch.pos.z, (Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2);
  match.events.emit('pickup', { ch, item: it.item, name: itemName(it.item) });
  return true;
}

/** Ammo and materials are collected automatically by walking over them. */
export function autoPickup(match, ch) {
  const list = match.world.loot.query(ch.pos.x, ch.pos.z, 1.4, near);
  for (const it of list) {
    if (!it.resting && it.t < 0.6) continue;
    const k = it.item.kind;
    if (k !== 'ammo' && k !== 'material') continue;
    if (Math.abs(it.y - ch.pos.y) > 2) continue;
    tryPickup(match, ch, it);
  }
}

export function openChest(match, ch, chest) {
  if (!chest.alive || chest.opened) return false;
  const ok = match.world.loot.openChest(chest);
  if (ok) ch.stats.chests++;
  return ok;
}

/** Best interactable for the player near the crosshair. */
export function findInteractable(match, ch, dirX, dirY, dirZ) {
  const ex = ch.pos.x, ey = ch.pos.y + 1.0, ez = ch.pos.z;
  let best = null, bestScore = Infinity;
  for (const c of match.world.loot.chests) {
    if (!c.alive || c.opened) continue;
    const dx = c.x - ex, dy = c.y + 0.4 - ey, dz = c.z - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d > 2.8) continue;
    const dot = (dx * dirX + dy * dirY + dz * dirZ) / Math.max(0.01, d);
    const score = d * 0.5 + (1 - dot) * 3 - 1;
    if (score < bestScore) { bestScore = score; best = { kind: 'chest', ref: c }; }
  }
  const list = match.world.loot.query(ex, ez, 2.4, near);
  for (const it of list) {
    if (it.item.kind === 'ammo' || it.item.kind === 'material') continue;
    const dx = it.x - ex, dy = it.y + 0.2 - ey, dz = it.z - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d > 2.6) continue;
    const dot = (dx * dirX + dy * dirY + dz * dirZ) / Math.max(0.01, d);
    const score = d * 0.5 + (1 - dot) * 3;
    if (score < bestScore) { bestScore = score; best = { kind: 'item', ref: it }; }
  }
  return best;
}
