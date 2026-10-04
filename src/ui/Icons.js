// Canvas-drawn item icons (cached as data URLs).
const cache = new Map();

function draw(key, fn, w = 96, h = 64) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.lineJoin = 'round';
  fn(g, w, h);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

function rect(g, x, y, w, h, col, r = 2) {
  g.fillStyle = col;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

const GUN = '#e8ecf0', DARK = '#9aa3ab';

export function iconFor(item) {
  if (!item) return null;
  if (item.kind === 'weapon') return weaponIcon(item.type);
  if (item.kind === 'consumable') return consumableIcon(item.type);
  return null;
}

export function weaponIcon(type) {
  return draw('w_' + type, (g) => {
    g.save(); g.translate(4, 6);
    switch (type) {
      case 'ar':
        rect(g, 12, 18, 52, 12, GUN); rect(g, 62, 21, 22, 5, DARK); rect(g, 0, 18, 16, 14, GUN, 3);
        rect(g, 34, 28, 9, 18, DARK); rect(g, 22, 28, 8, 14, GUN); rect(g, 36, 12, 14, 6, DARK); break;
      case 'shotgun':
        rect(g, 20, 18, 40, 11, GUN); rect(g, 56, 20, 30, 6, DARK); rect(g, 52, 27, 22, 6, GUN);
        rect(g, 0, 20, 22, 12, '#c79a6a', 3); rect(g, 26, 28, 7, 13, GUN); break;
      case 'smg':
        rect(g, 18, 16, 40, 13, GUN); rect(g, 56, 19, 14, 5, DARK); rect(g, 36, 28, 8, 24, DARK);
        rect(g, 22, 28, 8, 13, GUN); rect(g, 6, 18, 14, 4, DARK); break;
      case 'sniper':
        rect(g, 10, 22, 54, 10, GUN); rect(g, 62, 24, 26, 4, DARK); rect(g, 28, 10, 26, 8, GUN, 4);
        rect(g, 0, 22, 14, 14, GUN, 3); rect(g, 30, 31, 7, 12, DARK); break;
      case 'pistol':
        rect(g, 26, 16, 34, 11, GUN); rect(g, 28, 26, 11, 20, DARK); rect(g, 56, 18, 8, 5, DARK); break;
      case 'rocket':
        rect(g, 6, 16, 78, 16, '#cfd6dc', 7); rect(g, 6, 16, 10, 16, '#ffd04a', 4); rect(g, 74, 16, 10, 16, '#ffd04a', 4);
        rect(g, 34, 30, 8, 14, DARK); rect(g, 44, 8, 12, 8, DARK); break;
      case 'pickaxe':
        g.strokeStyle = '#c79a6a'; g.lineWidth = 6; g.beginPath(); g.moveTo(20, 50); g.lineTo(60, 10); g.stroke();
        g.strokeStyle = GUN; g.lineWidth = 7; g.beginPath(); g.moveTo(38, 4); g.quadraticCurveTo(64, 2, 80, 22); g.stroke(); break;
    }
    g.restore();
  });
}

export function consumableIcon(type) {
  return draw('c_' + type, (g) => {
    switch (type) {
      case 'bandage':
        rect(g, 22, 18, 52, 28, '#f4efe4', 12); g.strokeStyle = '#d8cbb0'; g.lineWidth = 3;
        for (let x = 34; x < 70; x += 10) { g.beginPath(); g.moveTo(x, 20); g.lineTo(x, 44); g.stroke(); } break;
      case 'medkit':
        rect(g, 22, 14, 52, 38, '#f0f0f0', 6); rect(g, 42, 20, 12, 26, '#ff4a4a'); rect(g, 35, 27, 26, 12, '#ff4a4a'); rect(g, 38, 8, 20, 8, '#bbbbbb', 3); break;
      case 'smallshield':
        rect(g, 38, 20, 22, 34, '#62c0ff', 8); rect(g, 44, 10, 10, 12, '#d0e6f5', 3); break;
      case 'bigshield':
        rect(g, 30, 16, 36, 42, '#2d7cff', 12); rect(g, 42, 4, 12, 14, '#d0e6f5', 3); rect(g, 36, 26, 8, 20, '#8fc6ff', 4); break;
      case 'grenade':
        g.fillStyle = '#7d9c4f'; g.beginPath(); g.arc(48, 36, 17, 0, Math.PI * 2); g.fill();
        rect(g, 42, 12, 12, 10, '#9aa3ab'); g.strokeStyle = '#ffd04a'; g.lineWidth = 3; g.beginPath(); g.arc(60, 14, 7, 0, Math.PI * 1.5); g.stroke(); break;
    }
  });
}

export function pieceIcon(type) {
  return draw('p_' + type, (g) => {
    g.fillStyle = '#e8f6ff'; g.strokeStyle = '#e8f6ff'; g.lineWidth = 4;
    switch (type) {
      case 'wall': g.strokeRect(26, 10, 44, 44); g.fillRect(26, 10, 44, 6); break;
      case 'floor': g.beginPath(); g.moveTo(14, 40); g.lineTo(48, 28); g.lineTo(82, 40); g.lineTo(48, 52); g.closePath(); g.stroke(); break;
      case 'stairs': g.beginPath(); g.moveTo(18, 54); for (let i = 0; i < 4; i++) { g.lineTo(18 + i * 15, 54 - (i + 1) * 11); g.lineTo(33 + i * 15, 54 - (i + 1) * 11); } g.lineTo(78, 54); g.closePath(); g.stroke(); break;
      case 'roof': g.beginPath(); g.moveTo(12, 50); g.lineTo(48, 12); g.lineTo(84, 50); g.closePath(); g.stroke(); break;
    }
  });
}

export function materialIcon(type) {
  return draw('m_' + type, (g) => {
    if (type === 'wood') { rect(g, 4, 10, 40, 14, '#c58b4c', 7); rect(g, 8, 26, 36, 12, '#a87038', 6); g.fillStyle = '#e0b07a'; g.beginPath(); g.arc(38, 17, 5, 0, 7); g.fill(); }
    else if (type === 'brick') { rect(g, 4, 10, 18, 11, '#c46a50'); rect(g, 24, 10, 18, 11, '#b05a42'); rect(g, 12, 23, 18, 11, '#c46a50'); rect(g, 32, 23, 12, 11, '#b05a42'); }
    else { rect(g, 6, 8, 34, 28, '#b8c6cf', 3); g.fillStyle = '#7f8e98'; for (const [x, y] of [[11, 13], [35, 13], [11, 31], [35, 31]]) { g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); } }
  }, 48, 44);
}
