// Storm circle logic (pure, unit tested). Phases: wait -> shrink, 8 phases ending in a closed circle.

export const STORM_PHASES = [
  { wait: 90, shrink: 60, radius: 480, dps: 1 },
  { wait: 60, shrink: 50, radius: 300, dps: 1 },
  { wait: 55, shrink: 45, radius: 190, dps: 2 },
  { wait: 45, shrink: 40, radius: 115, dps: 5 },
  { wait: 40, shrink: 35, radius: 65, dps: 8 },
  { wait: 35, shrink: 30, radius: 32, dps: 10 },
  { wait: 30, shrink: 25, radius: 12, dps: 12 },
  { wait: 25, shrink: 30, radius: 0, dps: 15 },
];

export const INITIAL_RADIUS = 1150;

export class StormLogic {
  /**
   * rng: RNG, isLand(x,z) -> bool, phases (optional override)
   */
  constructor(rng, isLand = () => true, phases = STORM_PHASES) {
    this.rng = rng;
    this.isLand = isLand;
    this.phases = phases;
    this.phase = 0;              // index of the current phase
    this.state = 'wait';         // 'wait' | 'shrink' | 'done'
    this.timer = phases[0].wait;
    this.cur = { x: 0, z: 0, r: INITIAL_RADIUS };
    this.from = { ...this.cur };
    this.next = this.pickNext(this.cur, phases[0].radius, 380);
    this.speed = 1;
  }

  /** Next circle fully inside `prev`, preferring centers on land. maxOffset caps the first shift. */
  pickNext(prev, r, maxOffset = Infinity) {
    let cand = null;
    const room = Math.max(0, Math.min(prev.r - r, maxOffset));
    for (let i = 0; i < 24; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const d = Math.sqrt(this.rng.next()) * room;
      cand = { x: prev.x + Math.cos(a) * d, z: prev.z + Math.sin(a) * d, r };
      if (this.isLand(cand.x, cand.z)) break;
    }
    return cand;
  }

  get dps() { return this.phases[Math.min(this.phase, this.phases.length - 1)].dps; }
  get phaseNumber() { return Math.min(this.phase + 1, this.phases.length); }
  get totalPhases() { return this.phases.length; }

  update(dt) {
    if (this.state === 'done') return null;
    this.timer -= dt * this.speed;
    let event = null;
    const p = this.phases[this.phase];
    if (this.state === 'wait') {
      if (this.timer <= 0) {
        this.state = 'shrink';
        this.timer = p.shrink;
        this.from = { ...this.cur };
        event = 'shrinkStart';
      }
    } else if (this.state === 'shrink') {
      const t = 1 - Math.max(0, this.timer) / p.shrink;
      this.cur.x = this.from.x + (this.next.x - this.from.x) * t;
      this.cur.z = this.from.z + (this.next.z - this.from.z) * t;
      this.cur.r = this.from.r + (this.next.r - this.from.r) * t;
      if (this.timer <= 0) {
        this.cur = { ...this.next };
        this.phase++;
        if (this.phase >= this.phases.length) { this.state = 'done'; this.phase = this.phases.length - 1; event = 'closed'; }
        else {
          this.state = 'wait';
          this.timer = this.phases[this.phase].wait;
          this.next = this.pickNext(this.cur, this.phases[this.phase].radius);
          event = 'phase';
        }
      }
    }
    return event;
  }

  isInside(x, z, margin = 0) {
    return Math.hypot(x - this.cur.x, z - this.cur.z) <= this.cur.r - margin;
  }
  distToEdge(x, z) { return this.cur.r - Math.hypot(x - this.cur.x, z - this.cur.z); }
  insideNext(x, z, margin = 0) { return Math.hypot(x - this.next.x, z - this.next.z) <= this.next.r - margin; }
  /** Seconds until the current circle reaches the next circle's size. */
  timeUntilClosed() {
    if (this.state === 'done') return 0;
    if (this.state === 'wait') return this.timer + this.phases[this.phase].shrink;
    return this.timer;
  }
}
