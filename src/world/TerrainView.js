// Chunked terrain mesh, water surface and sky dome.
import * as THREE from 'three';
import { WORLD_SIZE, HALF } from '../core/config.js';

const CHUNK = 128;

export class TerrainView {
  constructor(hm, res, scene) {
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const nC = WORLD_SIZE / CHUNK;
    const seg = CHUNK / res;
    const col = [0, 0, 0];
    const nrm = { x: 0, y: 1, z: 0 };
    const c3 = new THREE.Color();
    for (let cz = 0; cz < nC; cz++) {
      for (let cx = 0; cx < nC; cx++) {
        const x0 = -HALF + cx * CHUNK, z0 = -HALF + cz * CHUNK;
        const vcount = (seg + 1) * (seg + 1);
        const pos = new Float32Array(vcount * 3);
        const colors = new Float32Array(vcount * 3);
        let k = 0;
        let allWater = true;
        for (let j = 0; j <= seg; j++) {
          for (let i = 0; i <= seg; i++) {
            const x = x0 + i * res, z = z0 + j * res;
            const h = hm.height(x, z);
            if (h > -3) allWater = false;
            pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
            hm.normal(x, z, nrm);
            hm.colorAt(x, z, h, nrm.y, col);
            c3.setRGB(col[0], col[1], col[2], THREE.SRGBColorSpace);
            colors[k * 3] = c3.r; colors[k * 3 + 1] = c3.g; colors[k * 3 + 2] = c3.b;
            k++;
          }
        }
        if (allWater) continue; // deep ocean chunk: water plane covers it
        const idx = new Uint32Array(seg * seg * 6);
        let m = 0;
        for (let j = 0; j < seg; j++) {
          for (let i = 0; i < seg; i++) {
            const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
            idx[m++] = a; idx[m++] = c; idx[m++] = b;
            idx[m++] = b; idx[m++] = c; idx[m++] = d;
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, this.material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
      }
    }
    scene.add(this.group);
  }
  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.material.dispose();
    this.group.removeFromParent();
  }
}

export class WaterView {
  constructor(hm, scene, fog) {
    // Height texture for shoreline foam / depth tint.
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -HALF + (i + 0.5) / N * WORLD_SIZE, z = -HALF + (j + 0.5) / N * WORLD_SIZE;
      const h = hm.height(x, z);
      const v = Math.max(0, Math.min(255, Math.round((h + 30) / 60 * 255)));
      const k = (j * N + i) * 4;
      data[k] = v; data[k + 1] = v; data[k + 2] = v; data[k + 3] = 255;
    }
    this.tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.uniforms = {
      uTime: { value: 0 },
      uH: { value: this.tex },
      uFogColor: { value: fog.color },
      uFogNear: { value: fog.near },
      uFogFar: { value: fog.far },
      uHalf: { value: HALF },
      uSize: { value: WORLD_SIZE },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec3 vW;
        uniform float uTime;
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0);
          w.y += sin(w.x * 0.08 + uTime * 1.1) * 0.12 + cos(w.z * 0.07 + uTime * 0.9) * 0.12;
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vW;
        uniform float uTime, uFogNear, uFogFar, uHalf, uSize;
        uniform vec3 uFogColor;
        uniform sampler2D uH;
        void main(){
          vec2 uv = (vW.xz + uHalf) / uSize;
          float th = -30.0;
          if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) th = texture2D(uH, uv).r * 60.0 - 30.0;
          float depth = max(0.0, -th);
          vec3 shallow = vec3(0.16, 0.72, 0.78);
          vec3 deep = vec3(0.03, 0.24, 0.48);
          vec3 col = mix(shallow, deep, smoothstep(0.0, 14.0, depth));
          float w = sin(vW.x * 0.21 + uTime * 1.4) * sin(vW.z * 0.17 - uTime * 1.2) + 0.5 * sin((vW.x + vW.z) * 0.5 + uTime * 2.0);
          col += w * 0.025;
          float foam = smoothstep(1.6, 0.0, depth) * (0.55 + 0.45 * sin(depth * 7.0 - uTime * 2.6));
          col = mix(col, vec3(0.95, 0.98, 1.0), clamp(foam, 0.0, 1.0) * 0.65);
          float d = length(vW - cameraPosition);
          float f = smoothstep(uFogNear, uFogFar, d);
          col = mix(col, uFogColor, f);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(6000, 6000, 60, 60);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(t, fog) {
    this.uniforms.uTime.value = t;
    this.uniforms.uFogNear.value = fog.near;
    this.uniforms.uFogFar.value = fog.far;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tex.dispose(); this.mesh.removeFromParent(); }
}

export class SkyView {
  constructor(scene, sunDir, theme = null) {
    const top = theme ? theme.skyTop : [0.22, 0.5, 0.95], hor = theme ? theme.skyHor : [0.72, 0.86, 0.98];
    this.uniforms = { uSun: { value: sunDir.clone().normalize() }, uTint: { value: new THREE.Color(0, 0, 0) }, uTintAmt: { value: 0 },
      uTop: { value: new THREE.Vector3(...top) }, uHor: { value: new THREE.Vector3(...hor) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vD;
        void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */`
        varying vec3 vD;
        uniform vec3 uSun, uTint, uTop, uHor;
        uniform float uTintAmt;
        void main(){
          float h = vD.y;
          vec3 top = uTop;
          vec3 hor = uHor;
          vec3 col = mix(hor, top, smoothstep(0.0, 0.55, h));
          col = mix(col, vec3(0.62, 0.78, 0.92), smoothstep(0.0, -0.3, h));
          float s = max(dot(normalize(vD), uSun), 0.0);
          col += vec3(1.0, 0.9, 0.7) * pow(s, 400.0) * 3.0 + vec3(1.0, 0.85, 0.6) * pow(s, 12.0) * 0.25;
          col = mix(col, uTint, uTintAmt);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
  update(camPos) { this.mesh.position.copy(camPos); }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}
