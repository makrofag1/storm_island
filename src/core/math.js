export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const TAU = Math.PI * 2;
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export function lerpAngle(a, b, t) { return a + wrapAngle(b - a) * t; }
/** Move angle a toward b by at most maxStep. */
export function approachAngle(a, b, maxStep) {
  const d = wrapAngle(b - a);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}
export function approach(v, target, step) {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - step, target);
}
export const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Yaw convention: yaw=0 faces -Z, positive yaw turns left (counter-clockwise from above), matching three.js camera rotation.y. */
export const yawDirX = (yaw) => -Math.sin(yaw);
export const yawDirZ = (yaw) => -Math.cos(yaw);
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
export function formatTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
