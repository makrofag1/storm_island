// Instanced primitive batches (boxes, stairs, roofs) with a world-space procedural pattern shader.
import * as THREE from 'three';

export const PAT = { PLAIN: 0, WOOD: 1, BRICK: 2, METAL: 3, CONCRETE: 4, ROOF: 5, STRIPES: 6, GLASS: 7 };

const PATTERN_GLSL = /* glsl */`
varying float vPat;
varying vec3 vWP;
varying vec3 vWN;
float ph12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 patShade(float pat, vec3 wp, vec3 wn){
  float id = floor(pat + 0.0005);
  float dmg = clamp((pat - id) / 0.9, 0.0, 1.0);
  vec3 an = abs(wn);
  vec2 uv;
  if (an.y > 0.75) uv = wp.xz; else if (an.x > an.z) uv = wp.zy; else uv = wp.xy;
  float s = 1.0;
  if (id == 1.0) {
    float row = floor(uv.y / 0.42);
    float f = fract(uv.y / 0.42);
    s = 0.84 + 0.16 * ph12(vec2(row, floor(uv.x / 2.3 + row * 0.37)));
    s *= mix(0.72, 1.0, smoothstep(0.0, 0.08, f));
    s *= 0.94 + 0.06 * sin(uv.x * 8.0 + row * 3.0 + sin(uv.x * 1.3) * 2.0);
  } else if (id == 2.0) {
    float bh = 0.3;
    float row = floor(uv.y / bh);
    float bx = uv.x / 0.66 + mod(row, 2.0) * 0.5;
    vec2 f = vec2(fract(bx), fract(uv.y / bh));
    float brick = step(0.05, f.x) * step(0.1, f.y);
    s = mix(1.3, 0.86 + 0.24 * ph12(vec2(floor(bx), row)), brick);
  } else if (id == 3.0) {
    vec2 f = fract(uv / vec2(1.3333, 1.0));
    float edge = step(0.03, f.x) * step(0.04, f.y) * step(f.x, 0.97) * step(f.y, 0.96);
    s = mix(0.62, 1.0, edge) * (0.88 + 0.12 * f.y);
    s *= 0.94 + 0.06 * sin(uv.x * 26.0);
  } else if (id == 4.0) {
    s = 0.9 + 0.1 * ph12(floor(uv * 3.0)) ;
    s *= mix(0.85, 1.0, step(0.03, fract(uv.y / 3.0)));
  } else if (id == 5.0) {
    float row = floor(uv.y / 0.33);
    float f = fract(uv.y / 0.33);
    s = 0.78 + 0.28 * f;
    s *= 0.9 + 0.1 * ph12(vec2(floor(uv.x / 0.5 + row * 0.5), row));
  } else if (id == 6.0) {
    s = mix(0.75, 1.1, step(0.5, fract((uv.x + uv.y) * 0.5)));
  } else if (id == 7.0) {
    s = 0.8 + 0.4 * smoothstep(0.4, 0.6, fract((uv.x - uv.y) * 0.35));
  }
  if (dmg > 0.01) {
    vec2 c = uv * 1.6;
    float n = abs(sin(c.x * 3.1 + sin(c.y * 2.3) * 2.0) + sin(c.y * 3.7 + sin(c.x * 1.7) * 1.5));
    float crack = 1.0 - smoothstep(0.0, 0.1 * dmg + 0.02, n * 0.5);
    s *= 1.0 - crack * 0.75 * dmg;
    s *= 1.0 - dmg * 0.28;
  }
  return vec3(s);
}
`;

export function makePatternMaterial(opts = {}) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPat;\nvarying float vPat;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vPat = aPat;
  #ifdef USE_INSTANCING
    vec4 pwp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
    vWN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);
  #else
    vec4 pwp = modelMatrix * vec4(transformed, 1.0);
    vWN = normalize(mat3(modelMatrix) * objectNormal);
  #endif
  vWP = pwp.xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PATTERN_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= patShade(vPat, vWP, vWN);');
  };
  m.customProgramCacheKey = () => 'pattern-v1';
  return m;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class InstancedShapes {
  constructor(geometry, material, max, { castShadow = true, receiveShadow = true } = {}) {
    this.geometry = geometry.clone();
    this.max = max;
    this.patArr = new Float32Array(max);
    this.pat = new THREE.InstancedBufferAttribute(this.patArr, 1);
    this.pat.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aPat', this.pat);
    this.mesh = new THREE.InstancedMesh(this.geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    this.free = [];
    this.used = 0;
    this.dirtyM = false; this.dirtyC = false; this.dirtyP = false;
  }
  alloc() {
    let idx;
    if (this.free.length) idx = this.free.pop();
    else {
      if (this.used >= this.max) return -1;
      idx = this.used++;
      this.mesh.count = this.used;
    }
    return idx;
  }
  release(idx) {
    if (idx < 0) return;
    this.mesh.setMatrixAt(idx, ZERO);
    this.free.push(idx);
    this.dirtyM = true;
  }
  setBox(idx, minX, minY, minZ, maxX, maxY, maxZ) {
    _p.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    _s.set(maxX - minX, maxY - minY, maxZ - minZ);
    _q.identity();
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(idx, _m);
    this.dirtyM = true;
  }
  setTRS(idx, x, y, z, rotY, sx, sy, sz) {
    _p.set(x, y, z); _s.set(sx, sy, sz); _q.setFromAxisAngle(_up, rotY);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(idx, _m);
    this.dirtyM = true;
  }
  setMatrix(idx, m) { this.mesh.setMatrixAt(idx, m); this.dirtyM = true; }
  setColor(idx, color) {
    _c.set(color);
    this.mesh.setColorAt(idx, _c);
    this.dirtyC = true;
  }
  setRGB(idx, r, g, b) { _c.setRGB(r, g, b); this.mesh.setColorAt(idx, _c); this.dirtyC = true; }
  setPat(idx, v) { this.patArr[idx] = v; this.dirtyP = true; }
  flush() {
    if (this.dirtyM) { this.mesh.instanceMatrix.needsUpdate = true; this.dirtyM = false; }
    if (this.dirtyC) { this.mesh.instanceColor.needsUpdate = true; this.dirtyC = false; }
    if (this.dirtyP) { this.pat.needsUpdate = true; this.dirtyP = false; }
  }
  dispose() { this.geometry.dispose(); this.mesh.dispose(); }
}

/** Unit box centered at origin. */
export function unitBoxGeometry() { return new THREE.BoxGeometry(1, 1, 1); }

/** Stair geometry: unit footprint centered on XZ, base at y=0, rising toward +X to y=1. */
export function stairsGeometry(steps = 6) {
  const geos = [];
  for (let i = 0; i < steps; i++) {
    const g = new THREE.BoxGeometry(1 / steps, (i + 1) / steps, 1);
    g.translate(-0.5 + (i + 0.5) / steps, (i + 1) / steps / 2, 0);
    geos.push(g);
  }
  return mergeGeometries(geos);
}

/** Pyramid roof: unit footprint centered, base y=0, apex y=1. */
export function roofGeometry() {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, false);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0);
  return g.toNonIndexed();
}

/** Simple merge for geometries with position/normal/uv (indexed or not). */
export function mergeGeometries(geos) {
  let total = 0;
  const parts = geos.map((g) => { const ng = g.index ? g.toNonIndexed() : g; total += ng.attributes.position.count; return ng; });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let hasColor = parts.every((g) => g.attributes.color);
  const col = hasColor ? new Float32Array(total * 3) : null;
  let o = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (col) col.set(g.attributes.color.array, o * 3);
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const g of geos) g.dispose();
  for (const g of parts) g.dispose();
  return out;
}

/** Paint a whole geometry with a vertex color (helper for merged multi-color props). */
export function colorize(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
