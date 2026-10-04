// F3 overlay: FPS, frame/sim timings, draw calls, entity counts, selected bot state.
export class DebugOverlay {
  constructor(game) {
    this.game = game;
    this.el = document.createElement('pre');
    this.el.id = 'debug-overlay';
    this.el.className = 'hidden';
    game.uiRoot.appendChild(this.el);
    this.visible = false;
    this.t = 0;
  }
  toggle() {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
    if (this.game.match) this.game.match.setNavDebug(this.visible);
  }
  update(dt) {
    if (!this.visible) return;
    this.t += dt;
    if (this.t < 0.25) return;
    this.t = 0;
    const g = this.game;
    const ft = g.frameTimes;
    const avg = ft.reduce((a, b) => a + b, 0) / Math.max(1, ft.length);
    const worst = Math.max(...ft);
    const info = g.renderer.info;
    const lines = [
      `Storm Island debug (F3)  ·  GPU: ${g.gpu ? g.gpu.name + ' [' + g.gpu.kind + ']' : '?'}`,
      `FPS ${(1 / avg).toFixed(0)}  frame ${(avg * 1000).toFixed(1)} ms  worst ${(worst * 1000).toFixed(1)} ms`,
      `sim ${g.simMs.toFixed(2)} ms  draw calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k`,
      `geometries ${info.memory.geometries}  textures ${info.memory.textures}  state ${g.state}${g.paused ? ' (paused)' : ''}`,
    ];
    if (g.match) lines.push(...g.match.debugLines());
    this.el.textContent = lines.join('\n');
  }
}
