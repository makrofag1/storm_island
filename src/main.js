// Bootstrap: WebGL capability check, then start the Game.
import { Game } from './core/Game.js';
import { CONTEXT_ATTRIBUTES } from './core/gpu.js';

function fatal(msg) {
  const el = document.getElementById('fatal');
  el.innerHTML = `<div class="fatal-box"><h1>Storm Island</h1><p>${msg}</p></div>`;
  el.classList.remove('hidden');
}

function hasWebGL() {
  try {
    // Probe with the same attributes as the real renderer (high-performance GPU), then release it
    // right away so no extra low-power context stays alive.
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', CONTEXT_ATTRIBUTES) || c.getContext('webgl', CONTEXT_ATTRIBUTES);
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch {
    return false;
  }
}

if (!hasWebGL()) {
  fatal('Your browser or GPU does not support WebGL, which is required to play. Try an up-to-date Chrome, Edge or Firefox with hardware acceleration enabled.');
} else {
  try {
    const game = new Game(document.getElementById('gl'), document.getElementById('ui'));
    window.__game = game; // handy for debugging from the console
    game.start();
  } catch (e) {
    console.error(e);
    fatal('Failed to start the game: ' + (e && e.message ? e.message : e));
  }
}
