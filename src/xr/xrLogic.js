// Pure VR helpers (no DOM / Three.js): controller button mapping, turning, physical crouch and
// teleport target validation. Kept dependency-free so they run under `node --test`.

export const STICK_DEAD = 0.18;

/** Read an xr-standard gamepad (Quest Touch): buttons 0 trigger, 1 squeeze, 3 stick click, 4 A/X,
 * 5 B/Y; thumbstick on axes 2/3 (axes 0/1 on controllers without a touchpad slot). */
export function readPad(gp) {
  const s = { trigger: 0, squeeze: 0, stick: false, b1: false, b2: false, sx: 0, sy: 0 };
  if (!gp) return s;
  const b = gp.buttons || [], a = gp.axes || [];
  const v = (i) => (b[i] ? (b[i].value || (b[i].pressed ? 1 : 0)) : 0);
  s.trigger = v(0); s.squeeze = v(1);
  s.stick = !!(b[3] && b[3].pressed);
  s.b1 = !!(b[4] && b[4].pressed);
  s.b2 = !!(b[5] && b[5].pressed);
  let x = a.length >= 4 ? a[2] : a[0] || 0, y = a.length >= 4 ? a[3] : a[1] || 0;
  if (a.length >= 4 && Math.abs(x) + Math.abs(y) < 1e-3 && Math.abs(a[0] || 0) + Math.abs(a[1] || 0) > 0.1) { x = a[0]; y = a[1]; }
  s.sx = x || 0; s.sy = -(y || 0); // WebXR: stick up = negative y -> we use +y = forward
  return s;
}

/** Radial dead zone with rescale so motion starts smoothly right after the dead zone. */
export function deadzone(x, y, dz = STICK_DEAD) {
  const l = Math.hypot(x, y);
  if (l < dz) return [0, 0];
  const k = Math.min(1, (l - dz) / (1 - dz)) / l;
  return [x * k, y * k];
}

export const emptyPad = () => readPad(null);

/**
 * Map the dominant ("main") and off-hand pads to game actions. Edges are computed against the
 * previous frame's pads. Layout (right-handed): off-hand stick = move (click = sprint), off trigger =
 * aim / (build) material, off grip = big wrist map, X = build mode, Y = pause; main stick X = turn,
 * main stick Y = next / previous slot, main trigger = fire, main grip = grab / interact, A = jump,
 * B = reload / (build) rotate, main stick click = crouch / (build) edit.
 */
export function mapActions(main, off, pMain, pOff) {
  const on = (v) => v > 0.55, was = (v) => v > 0.35; // hysteresis for analog triggers
  const edge = (cur, prev) => cur && !prev;
  const [mx, my] = deadzone(off.sx, off.sy);
  const flick = (v, pv) => (v > 0.7 && pv <= 0.5 ? 1 : v < -0.7 && pv >= -0.5 ? -1 : 0);
  return {
    moveX: mx, moveY: my,
    turnX: deadzone(main.sx, 0, 0.25)[0],
    turnFlick: flick(main.sx, pMain.sx),
    slotStep: Math.abs(main.sy) > Math.abs(main.sx) ? flick(main.sy, pMain.sy) : 0,
    fire: on(main.trigger) || (was(main.trigger) && was(pMain.trigger)),
    firePressed: on(main.trigger) && !was(pMain.trigger),
    fireReleased: !was(main.trigger) && was(pMain.trigger),
    aim: on(off.trigger) || (was(off.trigger) && was(pOff.trigger)),
    aimPressed: on(off.trigger) && !was(pOff.trigger),
    grabPressed: on(main.squeeze) && !was(pMain.squeeze),
    mapHeld: on(off.squeeze),
    jump: main.b1, jumpPressed: edge(main.b1, pMain.b1),
    reloadPressed: edge(main.b2, pMain.b2),
    buildPressed: edge(off.b1, pOff.b1),
    pausePressed: edge(off.b2, pOff.b2),
    crouchPressed: edge(main.stick, pMain.stick),
    sprintPressed: edge(off.stick, pOff.stick),
  };
}

/** Snap turn: angle (radians, positive = left/CCW as yaw) for a stick flick, else 0. */
export function snapTurn(flick, angleDeg) { return flick ? -flick * angleDeg * Math.PI / 180 : 0; }

/** Smooth turn rate (rad/s) for the stick deflection. speedDeg = degrees per second at full tilt. */
export function smoothTurn(x, speedDeg, dt) { return -x * speedDeg * Math.PI / 180 * dt; }

/**
 * Rig placement so the head ends up exactly above the character: the rig (play-space origin) is
 * shifted by the head's local offset rotated by the rig yaw. Turning (changing rigYaw) therefore
 * rotates around the head, never around the play-space centre.
 */
export function rigOrigin(charX, charZ, headLocalX, headLocalZ, rigYaw) {
  const c = Math.cos(rigYaw), s = Math.sin(rigYaw);
  // Three.js Y rotation: x' = x c + z s, z' = -x s + z c
  const wx = headLocalX * c + headLocalZ * s, wz = -headLocalX * s + headLocalZ * c;
  return [charX - wx, charZ - wz];
}

/** World-space XZ delta of a local (play-space) head movement. */
export function localToWorldXZ(dx, dz, rigYaw) {
  const c = Math.cos(rigYaw), s = Math.sin(rigYaw);
  return [dx * c + dz * s, -dx * s + dz * c];
}

/** Physical crouch with hysteresis: crouch below 72 % of the calibrated head height, stand above 80 %. */
export function physicalCrouch(headY, calibrated, wasCrouched) {
  if (!(calibrated > 0.5)) return false;
  const r = headY / calibrated;
  return wasCrouched ? r < 0.8 : r < 0.72;
}

export const TELEPORT_MAX = 8;
/** A teleport target must be ground-like (normal mostly up), dry and within reach. */
export function validTeleport(fromX, fromZ, hit, maxDist = TELEPORT_MAX) {
  if (!hit || !hit.hit) return false;
  if (hit.ny < 0.7) return false;
  if (hit.y < 0.2) return false; // sea / lake surface level: would land in water
  return Math.hypot(hit.x - fromX, hit.z - fromZ) <= maxDist;
}

/** Hand speed (m/s) from a short history of {t, x, y, z} samples (newest last). */
export function handVelocity(hist) {
  if (hist.length < 2) return { x: 0, y: 0, z: 0, speed: 0 };
  const a = hist[0], b = hist[hist.length - 1];
  const dt = Math.max(1e-3, b.t - a.t);
  const x = (b.x - a.x) / dt, y = (b.y - a.y) / dt, z = (b.z - a.z) / dt;
  return { x, y, z, speed: Math.hypot(x, y, z) };
}
