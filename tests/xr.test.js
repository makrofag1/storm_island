// VR logic (pure functions from src/xr/xrLogic.js): controller mapping, turning, crouch, teleport.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readPad, deadzone, emptyPad, mapActions, snapTurn, smoothTurn, rigOrigin, localToWorldXZ,
  physicalCrouch, validTeleport, handVelocity,
} from '../src/xr/xrLogic.js';

const btn = (value = 0, pressed = value > 0.5) => ({ value, pressed });
const gamepad = ({ trigger = 0, squeeze = 0, stick = false, b1 = false, b2 = false, sx = 0, sy = 0 } = {}) => ({
  buttons: [btn(trigger), btn(squeeze), btn(), btn(0, stick), btn(0, b1), btn(0, b2)],
  axes: [0, 0, sx, sy],
});

test('readPad maps the xr-standard layout (stick up = forward)', () => {
  const p = readPad(gamepad({ trigger: 0.9, squeeze: 0.2, stick: true, b1: true, sx: 0.5, sy: -1 }));
  assert.equal(p.trigger, 0.9);
  assert.equal(p.squeeze, 0.2);
  assert.equal(p.stick, true);
  assert.equal(p.b1, true);
  assert.equal(p.b2, false);
  assert.equal(p.sx, 0.5);
  assert.equal(p.sy, 1); // WebXR reports up as -1
  assert.deepEqual(readPad(null), emptyPad());
  // 2-axis controllers put the stick on axes 0/1
  const two = readPad({ buttons: [], axes: [0.3, -0.8] });
  assert.equal(two.sx, 0.3); assert.equal(two.sy, 0.8);
});

test('deadzone removes drift and rescales smoothly to full tilt', () => {
  assert.deepEqual(deadzone(0.1, 0.05), [0, 0]);
  const [x, y] = deadzone(1, 0);
  assert.ok(Math.abs(x - 1) < 1e-9 && y === 0);
  const [hx] = deadzone(0.6, 0);
  assert.ok(hx > 0 && hx < 0.6);
});

test('mapActions: triggers give fire edges with hysteresis, buttons give single presses', () => {
  const E = emptyPad();
  const main = { ...E, trigger: 0.9, b1: true };
  let a = mapActions(main, E, E, E);
  assert.equal(a.fire, true); assert.equal(a.firePressed, true);
  assert.equal(a.jump, true); assert.equal(a.jumpPressed, true);
  // held next frame: still firing, no new press
  a = mapActions(main, E, main, E);
  assert.equal(a.fire, true); assert.equal(a.firePressed, false); assert.equal(a.jumpPressed, false);
  // trigger eased to 0.45 stays "held" (hysteresis), release fires at < 0.35
  const half = { ...E, trigger: 0.45 };
  a = mapActions(half, E, main, E);
  assert.equal(a.fire, true);
  a = mapActions(E, E, half, E);
  assert.equal(a.fire, false); assert.equal(a.fireReleased, true);
  // off hand: stick = move, X = build, Y = pause, grip = map
  const off = { ...E, sx: 0, sy: 1, b1: true, b2: true, squeeze: 1 };
  a = mapActions(E, off, E, E);
  assert.ok(a.moveY > 0.99 && a.moveX === 0);
  assert.equal(a.buildPressed, true); assert.equal(a.pausePressed, true); assert.equal(a.mapHeld, true);
});

test('mapActions: main stick flicks turn (X) or cycle slots (Y), once per flick', () => {
  const E = emptyPad();
  let a = mapActions({ ...E, sx: 1 }, E, E, E);
  assert.equal(a.turnFlick, 1); assert.equal(a.slotStep, 0);
  a = mapActions({ ...E, sx: 1 }, E, { ...E, sx: 1 }, E);
  assert.equal(a.turnFlick, 0);
  a = mapActions({ ...E, sy: -0.9 }, E, E, E);
  assert.equal(a.slotStep, -1); assert.equal(a.turnFlick, 0);
});

test('snap / smooth turn directions match the game yaw convention (positive yaw = left)', () => {
  assert.ok(Math.abs(snapTurn(1, 30) + Math.PI / 6) < 1e-9);  // flick right -> turn right (yaw decreases)
  assert.ok(Math.abs(snapTurn(-1, 45) - Math.PI / 4) < 1e-9);
  assert.equal(snapTurn(0, 30), 0);
  assert.ok(smoothTurn(1, 90, 1) < 0);
});

test('rigOrigin keeps the head above the character for any rig yaw (turning rotates around the head)', () => {
  const headLocal = { x: 0.7, z: -0.4 };
  for (const yaw of [0, 0.5, -2, Math.PI]) {
    const [ox, oz] = rigOrigin(10, 20, headLocal.x, headLocal.z, yaw);
    const [wx, wz] = localToWorldXZ(headLocal.x, headLocal.z, yaw);
    assert.ok(Math.abs(ox + wx - 10) < 1e-9 && Math.abs(oz + wz - 20) < 1e-9);
  }
  // play-space forward (-Z) turned by 90° left points to world -X
  const [fx, fz] = localToWorldXZ(0, -1, Math.PI / 2);
  assert.ok(Math.abs(fx + 1) < 1e-9 && Math.abs(fz) < 1e-9);
});

test('physical crouch uses hysteresis around the calibrated height', () => {
  assert.equal(physicalCrouch(1.7, 1.7, false), false);
  assert.equal(physicalCrouch(1.15, 1.7, false), true);   // 68 %
  assert.equal(physicalCrouch(1.3, 1.7, true), true);     // 76 %: stays crouched
  assert.equal(physicalCrouch(1.3, 1.7, false), false);   // ...but does not start crouching
  assert.equal(physicalCrouch(1.0, 0, false), false);     // not calibrated yet
});

test('teleport targets must be flat, dry and within reach', () => {
  const ok = { hit: true, x: 3, y: 5, z: 4, ny: 0.95 };
  assert.equal(validTeleport(0, 0, ok), true);
  assert.equal(validTeleport(0, 0, { ...ok, ny: 0.3 }), false);       // wall
  assert.equal(validTeleport(0, 0, { ...ok, y: 0 }), false);          // water level
  assert.equal(validTeleport(0, 0, { ...ok, x: 30 }), false);         // too far
  assert.equal(validTeleport(0, 0, { hit: false }), false);
});

test('handVelocity from position history', () => {
  const v = handVelocity([{ t: 0, x: 0, y: 0, z: 0 }, { t: 0.05, x: 0, y: 0, z: -0.2 }]);
  assert.ok(Math.abs(v.z + 4) < 1e-9 && Math.abs(v.speed - 4) < 1e-9);
  assert.equal(handVelocity([]).speed, 0);
});

test('controller hints follow the game situation and the physical button letters', async () => {
  const { hintRows, relabel } = await import('../src/xr/XRHints.js');
  const base = { mode: 'ground', alive: true, building: false, editing: false, phase: 'play', paused: false, teleport: false, smoothTurn: false, item: 'gun' };
  const main = hintRows(true, base);
  assert.deepEqual(main[0], ['TRIGGER', 'Fire']);
  assert.ok(main.some(([b, w]) => b === 'A' && w === 'Jump'));
  assert.ok(hintRows(true, { ...base, building: true }).some(([, w]) => w === 'Place piece'));
  assert.ok(hintRows(true, { ...base, mode: 'bus' }).some(([b, w]) => b === 'A' && /bus/.test(w)));
  assert.ok(hintRows(true, { ...base, alive: false }).some(([, w]) => w === 'Next player'));
  assert.ok(hintRows(false, { ...base, teleport: true }).some(([, w]) => /teleport/i.test(w)));
  // left-handed: the gun hand is the left controller, whose face buttons are X / Y
  const lefty = relabel(main, true, ['X', 'Y']);
  assert.ok(lefty.some(([b, w]) => b === 'X' && w === 'Jump') && lefty.some(([b, w]) => b === 'Y' && w === 'Reload'));
  assert.deepEqual(relabel(main, true, ['A', 'B']), main);
});
