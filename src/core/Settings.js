// Persistent user settings (localStorage), including key bindings.
import { isTouchDevice } from './Input.js';
import { MAP_DEFAULTS } from '../world/MapOptions.js';

export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  sprint: 'ShiftLeft', jump: 'Space', crouch: 'KeyC', interact: 'KeyE', reload: 'KeyR',
  pickaxe: 'KeyF', slot1: 'Digit2', slot2: 'Digit3', slot3: 'Digit4', slot4: 'Digit5', slot5: 'Digit6',
  pickaxeAlt: 'Digit1',
  build: 'KeyQ', wall: 'KeyZ', floor: 'KeyX', stairs: 'KeyT', roof: 'KeyY', edit: 'KeyG',
  rotate: 'KeyR', map: 'KeyM', mapAlt: 'Tab', shoulder: 'KeyV', emote: 'KeyB',
};

export const KEY_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right',
  sprint: 'Sprint', jump: 'Jump / deploy glider', crouch: 'Crouch (Ctrl too, in fullscreen)', interact: 'Interact / pick up / open',
  reload: 'Reload (build mode: rotate)', pickaxe: 'Pickaxe', pickaxeAlt: 'Pickaxe (alt)',
  slot1: 'Slot 1', slot2: 'Slot 2', slot3: 'Slot 3', slot4: 'Slot 4', slot5: 'Slot 5',
  build: 'Toggle build mode', wall: 'Build wall', floor: 'Build floor', stairs: 'Build stairs', roof: 'Build roof',
  edit: 'Edit structure', rotate: 'Rotate piece', map: 'Map', mapAlt: 'Map (alt)', shoulder: 'Swap shoulder', emote: 'Emote',
};

const DEFAULTS = {
  sensitivity: 1.0,
  adsSensitivity: 0.75,
  invertY: false,
  fov: 80,
  quality: 'medium',
  master: 0.8,
  sfx: 0.9,
  music: 0.45,
  botCount: 99,             // 99 bots + you = 100 players (phones start with 49)
  difficulty: 'mixed',
  seed: '',
  showFps: false,
  touchControls: 'auto',
  touchSensitivity: 1.0,
  touchAutoFire: true,       // touch: shoot automatically while the crosshair is on an enemy
  touchAimAssist: true,      // touch: crosshair slows down on / gently follows a nearby enemy
  touchLeftFire: true,       // touch: second FIRE button on the left (shoot while aiming with the right thumb)
  vrMove: 'stick',           // VR locomotion: 'stick' (smooth) | 'teleport'
  vrMoveDir: 'head',         // stick movement relative to the 'head' or the off-hand 'controller'
  vrTurn: 'snap',            // 'snap' | 'smooth'
  vrSnapAngle: 30,           // degrees per snap turn
  vrTurnSpeed: 120,          // smooth turn, degrees per second
  vrVignette: 'low',         // comfort vignette during artificial motion: 'off' | 'low' | 'strong'
  vrHand: 'right',           // dominant hand (gun / trigger hand)
  vrSeated: false,           // seated play: no physical crouch detection
  vrBots: 49,                // bot count for VR matches (the headset has a phone-class CPU)
  vrQuality: 'balanced',     // 'balanced' (90 Hz, shadows) | 'performance' (72 Hz, no shadows / grass)
  ...MAP_DEFAULTS,
  keys: { ...DEFAULT_KEYS },
  v: 2,
};

const STORAGE_KEY = 'stormisland.settings.v1';

export class Settings {
  constructor() {
    this.data = structuredClone(DEFAULTS);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw && isTouchDevice()) { this.data.quality = 'low'; this.data.botCount = 49; } // first run on a phone/tablet
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.assign(this.data, parsed);
        this.data.keys = { ...DEFAULT_KEYS, ...(parsed.keys || {}) };
        // v1 -> v2: the old default lobby (49 bots) becomes the full 100-player lobby on desktop
        if (!parsed.v) { if (parsed.botCount === 49 && !isTouchDevice()) this.data.botCount = 99; this.data.v = 2; }
      }
    } catch { /* storage unavailable -> defaults */ }
    this.listeners = [];
  }
  get(k) { return this.data[k]; }
  set(k, v) {
    this.data[k] = v;
    this.save();
    for (const l of this.listeners) l(k, v);
  }
  onChange(fn) { this.listeners.push(fn); }
  resetKeys() { this.set('keys', { ...DEFAULT_KEYS }); }
  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }
}
