// Time-budgeted path request queue with a small path cache, long-distance segmenting, and
// time-sliced A*: a long search is paused when the per-frame budget runs out and resumed next frame,
// so pathfinding never causes frame hitches.

const LONG = 240;
const SLICE = 400; // nodes expanded between budget checks

export class Navigator {
  constructor(match, nav) {
    this.match = match;
    this.nav = nav;
    this.queue = [];
    this.cache = new Map();
    this.active = null;
    this.stats = { solved: 0, cacheHits: 0, lastMs: 0, expanded: 0, sliced: 0 };
  }

  /** Ask for a path for `bot` to (gx,gz). The bot's onPath(result, req) is called later. */
  request(bot, gx, gz, tag) {
    const req = { bot, gx, gz, tag, t: this.match.time };
    if (bot.pathReq) {
      const i = this.queue.indexOf(bot.pathReq);
      if (i >= 0) this.queue[i] = req; else this.queue.push(req);
    } else this.queue.push(req);
    bot.pathReq = req;
    return req;
  }

  cancel(bot) {
    if (!bot.pathReq) return;
    const i = this.queue.indexOf(bot.pathReq);
    if (i >= 0) this.queue.splice(i, 1);
    bot.pathReq = null;
  }

  cacheKey(ch, gx, gz) {
    return `${Math.floor(ch.pos.x / 8)},${Math.floor(ch.pos.z / 8)}>${Math.floor(gx / 6)},${Math.floor(gz / 6)}`;
  }

  /** Start work on a request; returns true if it finished immediately (cache / trivial). */
  start(req) {
    const bot = req.bot, ch = bot.ch;
    let gx = req.gx, gz = req.gz;
    const dist = Math.hypot(gx - ch.pos.x, gz - ch.pos.z);
    const partialGoal = dist > LONG;
    if (partialGoal) {
      const k = LONG / dist;
      gx = ch.pos.x + (gx - ch.pos.x) * k; gz = ch.pos.z + (gz - ch.pos.z) * k;
    }
    const key = this.cacheKey(ch, gx, gz);
    const c = this.cache.get(key);
    if (c && c.version === this.nav.version && this.match.time - c.t < 20) {
      this.stats.cacheHits++;
      this.deliver(req, { points: c.points.map((p) => ({ ...p })), complete: c.complete }, null, partialGoal);
      return true;
    }
    const search = this.nav.beginPath(ch.pos.x, ch.pos.z, gx, gz, 12000);
    if (!search || search.result) { this.deliver(req, search ? search.result : null, null, partialGoal); return true; }
    req.version = search.version;
    this.active = { req, search, key, partialGoal };
    return false;
  }

  deliver(req, res, key, partialGoal) {
    const bot = req.bot;
    if (res && key) {
      this.stats.expanded += res.expanded || 0;
      this.cache.set(key, { points: res.points.map((p) => ({ ...p })), complete: res.complete, version: req.version ?? this.nav.version, t: this.match.time });
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
    }
    if (res && partialGoal) res.complete = false;
    this.stats.solved++;
    if (bot.pathReq !== req || !bot.ch.alive) return; // superseded while searching
    bot.pathReq = null;
    bot.onPath(res, req);
  }

  update(budgetMs) {
    const t0 = performance.now();
    let n = 0;
    while (performance.now() - t0 < budgetMs) {
      if (!this.active) {
        const req = this.queue.shift();
        if (!req) break;
        if (req.bot.pathReq !== req || !req.bot.ch.alive) continue;
        if (this.start(req)) { n++; continue; }
      }
      const a = this.active;
      // drop searches whose requester moved on (grid edits mid-search are tolerated: bots re-path when stuck)
      if (a.req.bot.pathReq !== a.req) { this.active = null; continue; }
      const res = this.nav.continuePath(a.search, SLICE);
      if (res) { this.active = null; this.deliver(a.req, res, a.key, a.partialGoal); n++; }
      else this.stats.sliced++;
    }
    this.stats.lastMs = performance.now() - t0;
    return n;
  }
}
