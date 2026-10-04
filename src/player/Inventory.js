// Inventory: pickaxe (slot 0) + 5 item slots, ammo pools and building materials. Pure logic.
import { CONSUMABLES, AMMO_MAX } from '../combat/Items.js';
import { MAX_MATS } from '../core/config.js';

export class Inventory {
  constructor() {
    this.slots = [null, null, null, null, null];
    this.sel = 0; // 0 = pickaxe, 1..5 = slots
    this.ammo = { light: 0, medium: 0, heavy: 0, shells: 0, rockets: 0 };
    this.mats = { wood: 0, brick: 0, metal: 0 };
  }
  current() { return this.sel === 0 ? null : this.slots[this.sel - 1]; }
  firstEmpty() { return this.slots.indexOf(null); }
  weapons() { return this.slots.filter((s) => s && s.kind === 'weapon'); }
  hasWeapon() { return this.slots.some((s) => s && s.kind === 'weapon'); }
  count(type) { let n = 0; for (const s of this.slots) if (s && s.kind === 'consumable' && s.type === type) n += s.count; return n; }
  slotOf(pred) { for (let i = 0; i < 5; i++) if (this.slots[i] && pred(this.slots[i])) return i; return -1; }

  /**
   * Try to take an item. Returns { taken: bool, dropped: item|null, rest: item|null }.
   * `rest` is a remainder that should stay on the ground (e.g. ammo over the cap).
   */
  add(item, allowSwap = true) {
    if (item.kind === 'ammo') {
      const space = AMMO_MAX[item.type] - this.ammo[item.type];
      if (space <= 0) return { taken: false, dropped: null, rest: item };
      const take = Math.min(space, item.count);
      this.ammo[item.type] += take;
      return { taken: true, dropped: null, rest: take < item.count ? { ...item, count: item.count - take } : null };
    }
    if (item.kind === 'material') {
      const space = MAX_MATS - this.mats[item.type];
      if (space <= 0) return { taken: false, dropped: null, rest: item };
      const take = Math.min(space, item.count);
      this.mats[item.type] += take;
      return { taken: true, dropped: null, rest: take < item.count ? { ...item, count: item.count - take } : null };
    }
    if (item.kind === 'consumable') {
      const def = CONSUMABLES[item.type];
      let left = item.count;
      for (const s of this.slots) {
        if (left <= 0) break;
        if (s && s.kind === 'consumable' && s.type === item.type && s.count < def.stack) {
          const t = Math.min(def.stack - s.count, left);
          s.count += t; left -= t;
        }
      }
      if (left <= 0) return { taken: true, dropped: null, rest: null };
      const e = this.firstEmpty();
      if (e >= 0) { this.slots[e] = { ...item, count: left }; return { taken: true, dropped: null, rest: null }; }
      if (left < item.count) return { taken: true, dropped: null, rest: { ...item, count: left } };
    } else if (item.kind === 'weapon') {
      const e = this.firstEmpty();
      if (e >= 0) { this.slots[e] = item; return { taken: true, dropped: null, rest: null }; }
    }
    // full: swap with current slot
    if (!allowSwap || this.sel === 0) return { taken: false, dropped: null, rest: item };
    const dropped = this.slots[this.sel - 1];
    this.slots[this.sel - 1] = item;
    return { taken: true, dropped, rest: null };
  }

  /** Consume one unit of a consumable in slot index i. */
  consumeAt(i) {
    const s = this.slots[i];
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.slots[i] = null;
  }

  /** Everything this inventory holds, as droppable item stacks. */
  dropAll() {
    const out = [];
    for (let i = 0; i < 5; i++) if (this.slots[i]) { out.push(this.slots[i]); this.slots[i] = null; }
    for (const k in this.ammo) if (this.ammo[k] > 0) { out.push({ kind: 'ammo', type: k, count: this.ammo[k] }); this.ammo[k] = 0; }
    for (const k in this.mats) if (this.mats[k] > 0) { out.push({ kind: 'material', type: k, count: this.mats[k] }); this.mats[k] = 0; }
    return out;
  }
}
