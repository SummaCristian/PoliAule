// Builds the 3D models the seasonal decorations stand on the Campus map
// (components/halloween.js): public/models/halloween/{pumpkin,tombstone,skull,ghost}.glb.
//
// Each one is made from a few simple shapes (lathes, an extrusion) right here,
// with plain coloured materials, so there are no third-party assets and the
// files stay a few KB. Units are metres at real size, y up (glTF), standing on
// y = 0; the map layer scales them up so they read from campus zoom.
//
// Run by hand when the shapes change: node scripts/build_season_models.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'halloween');

// ── Geometry ──────────────────────────────────────────────────────────────
// A part is { positions: number[], indices: number[], material }; normals are
// worked out from the faces when the file is written.

// Revolves a profile of [radius, y] points round the y axis. `radiusAt(theta, i)`
// scales a ring's radius (a pumpkin's ribs), `yAt(theta, i, y)` moves its points
// up or down (a ghost's wavy hem).
function lathe(profile, segments, material, { radiusAt = () => 1, yAt = (t, i, y) => y } = {}) {
  const positions = [], indices = [];
  profile.forEach(([r, y], i) => {
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const rr = r * radiusAt(theta, i);
      positions.push(Math.cos(theta) * rr, yAt(theta, i, y), Math.sin(theta) * rr);
    }
  });
  const row = segments + 1;
  for (let i = 0; i < profile.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * row + s, b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions, indices, material };
}

// A flat, convex outline (in the xy plane) extruded `depth` along z, centred on z = 0.
function extrude(outline, depth, material) {
  const positions = [], indices = [];
  const n = outline.length;
  const z = depth / 2;
  // Front and back caps, fanned from their first point
  for (const [face, zz] of [[1, z], [-1, -z]]) {
    const base = positions.length / 3;
    for (const [x, y] of outline) positions.push(x, y, zz);
    for (let i = 1; i < n - 1; i++) {
      if (face > 0) indices.push(base, base + i, base + i + 1);
      else indices.push(base, base + i + 1, base + i);
    }
  }
  // Sides, each edge its own quad so it keeps a flat normal
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i], [x1, y1] = outline[(i + 1) % n];
    const base = positions.length / 3;
    positions.push(x0, y0, z, x1, y1, z, x1, y1, -z, x0, y0, -z);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return { positions, indices, material };
}

function sphere(r, material, { segments = 18, rings = 12, squash = [1, 1, 1] } = {}) {
  const profile = [];
  for (let i = 0; i <= rings; i++) {
    const a = -Math.PI / 2 + (i / rings) * Math.PI;
    profile.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const part = lathe(profile, segments, material);
  for (let i = 0; i < part.positions.length; i += 3) {
    part.positions[i] *= squash[0];
    part.positions[i + 1] *= squash[1];
    part.positions[i + 2] *= squash[2];
  }
  return part;
}

function cylinder(r, length, material, segments = 10) {
  return lathe([[0, 0], [r, 0], [r, length], [0, length]], segments, material);
}

// Moves a part: rotations in radians about x, then y, then z, then a translation.
function place(part, { rx = 0, ry = 0, rz = 0, t = [0, 0, 0] } = {}) {
  const p = part.positions;
  for (let i = 0; i < p.length; i += 3) {
    let [x, y, z] = [p[i], p[i + 1], p[i + 2]];
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    p[i] = x + t[0]; p[i + 1] = y + t[1]; p[i + 2] = z + t[2];
  }
  return part;
}

// Flat shapes laid on a body of revolution, facing +z: each [u, v] point
// (metres sideways along the surface, and up from `centreY`) lands on the
// body, whose radius at an angle and height is `radiusAt(theta, y)`, a hair
// outside it. For a pumpkin's carved face.
function decal(shapes, centreY, radiusAt, material) {
  const positions = [], indices = [];
  for (const shape of shapes) {
    const base = positions.length / 3;
    for (const [u, v] of shape) {
      const y = centreY + v;
      // Close enough for a face: the angle from the arc length at the body's width
      const theta = Math.PI / 2 - u / radiusAt(Math.PI / 2, y);
      const rr = radiusAt(theta, y) + 0.01;
      positions.push(Math.cos(theta) * rr, y, Math.sin(theta) * rr);
    }
    for (let i = 1; i < shape.length - 1; i++) indices.push(base, base + i, base + i + 1);
  }
  return { positions, indices, material };
}

// ── The models ────────────────────────────────────────────────────────────

// `emissive` is a colour a material gives off. Mapbox adds it to the shading
// whatever the layer's emissive strength, so by day only the pumpkin's face
// has one; the night versions (NIGHT, below) give every part one, since with
// the strength turned up Mapbox draws a model mostly in these colours and a
// part without one goes black.
const MATERIALS = {
  pumpkin: { color: [0.93, 0.42, 0.06], roughness: 0.6 },
  rib: { color: [0.80, 0.32, 0.03], roughness: 0.6 },
  stem: { color: [0.28, 0.36, 0.15], roughness: 0.9 },
  glow: { color: [1.0, 0.78, 0.22], roughness: 1, emissive: [1.0, 0.7, 0.15] },
  stone: { color: [0.55, 0.57, 0.59], roughness: 0.95 },
  stoneDark: { color: [0.38, 0.40, 0.42], roughness: 0.95 },
  moss: { color: [0.25, 0.42, 0.18], roughness: 1 },
  bone: { color: [0.94, 0.91, 0.84], roughness: 0.7 },
  socket: { color: [0.08, 0.07, 0.07], roughness: 1 },
  ghost: { color: [0.97, 0.97, 1.0], roughness: 0.4, emissive: [0.35, 0.37, 0.45] },
};

// What changes for the models' night versions (<name>-night.glb)
const NIGHT = {
  pumpkin: { emissive: [0.95, 0.45, 0.08] },
  rib: { emissive: [0.8, 0.33, 0.04] },
  stem: { emissive: [0.16, 0.2, 0.08] },
  glow: { emissive: [1.0, 0.85, 0.35] },
  ghost: { emissive: [0.82, 0.88, 0.95] },
};

function pumpkin() {
  const R = 0.45, H = 0.62;
  // A squat ball, ribbed, with a dimple at the top where the stem goes in
  const ribs = 8;
  const ribAt = (theta) => 1 + 0.07 * Math.cos(theta * ribs) - 0.035;
  const radiusAtY = (y) => R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, y / H)))), 0.75);
  const profile = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    profile.push([Math.max(radiusAtY(H * t), 0.0001), H * t - (t > 0.92 ? (t - 0.92) * 0.9 : 0)]);
  }
  const body = lathe(profile, 48, 'pumpkin', { radiusAt: ribAt });
  const stem = place(cylinder(0.045, 0.16, 'stem', 8), { rz: 0.25, t: [0, H - 0.07, 0] });
  // The carved face: two triangle eyes, a nose, a grin with teeth
  const cy = H * 0.52;
  const eye = (s) => [[s * 0.07, 0.05], [s * 0.17, 0.05], [s * 0.12, 0.14]];
  const mouth = [];
  const grin = [];
  for (let i = 0; i <= 8; i++) {
    const u = -0.2 + (i / 8) * 0.4;
    const top = -0.07 + 0.05 * Math.pow(u / 0.2, 2);
    const bottom = -0.17 + 0.08 * Math.pow(u / 0.2, 2);
    grin.push([u, top, bottom]);
  }
  for (let i = 0; i < grin.length - 1; i++) {
    const [u0, t0, b0] = grin[i], [u1, t1, b1] = grin[i + 1];
    // Every third gap left uncut: the teeth
    const tooth = i % 3 === 1;
    mouth.push([[u0, tooth ? t0 - 0.035 : t0], [u0, b0], [u1, b1], [u1, tooth ? t1 - 0.035 : t1]]);
  }
  const face = decal([eye(-1), eye(1), [[-0.035, -0.01], [0.035, -0.01], [0, 0.05]], ...mouth], cy,
    (theta, y) => radiusAtY(y) * ribAt(theta), 'glow');
  return [body, stem, face];
}

function tombstone() {
  const W = 0.32, H = 0.55, T = 0.12;
  const outline = [[-W, 0], [W, 0], [W, H]];
  for (let i = 1; i < 12; i++) {
    const a = (i / 12) * Math.PI;
    outline.push([Math.cos(a) * W, H + Math.sin(a) * W]);
  }
  outline.push([-W, H]);
  const slab = place(extrude(outline, T, 'stone'), { rx: -0.1, rz: 0.06 });
  // A darker plaque on the front, and moss at the foot
  const plaque = place(extrude([[-0.16, 0.22], [0.16, 0.22], [0.16, 0.5], [-0.16, 0.5]], 0.02, 'stoneDark'), { t: [0, 0, T / 2 + 0.005] });
  place(plaque, { rx: -0.1, rz: 0.06 });
  const moss = place(sphere(0.12, 'moss', { squash: [2.6, 0.35, 1.1] }), { t: [0.05, 0.01, 0.06] });
  return [slab, plaque, moss];
}

function skull() {
  const cranium = sphere(0.2, 'bone', { squash: [1, 0.95, 1.1], segments: 24, rings: 16 });
  place(cranium, { t: [0, 0.27, 0] });
  const jaw = place(sphere(0.13, 'bone', { squash: [1.05, 0.7, 1] }), { t: [0, 0.12, 0.06] });
  const eyeL = place(sphere(0.055, 'socket'), { t: [-0.075, 0.27, 0.18] });
  const eyeR = place(sphere(0.055, 'socket'), { t: [0.075, 0.27, 0.18] });
  const nose = place(sphere(0.028, 'socket', { squash: [0.8, 1.3, 1] }), { t: [0, 0.18, 0.2] });
  // Crossbones lying on the ground, crossing behind it: each bone built along
  // x and centred, then turned, with a knob at both ends
  const L = 0.72, behind = -0.1;
  const parts = [];
  for (const turn of [0.6, -0.6]) {
    const bone = place(cylinder(0.03, L, 'bone'), { rz: -Math.PI / 2, t: [-L / 2, 0, 0] });
    parts.push(place(bone, { ry: turn, t: [0, 0.035, behind] }));
    for (const end of [-1, 1]) {
      const x = end * (L / 2) * Math.cos(turn), z = -end * (L / 2) * Math.sin(turn);
      parts.push(place(sphere(0.05, 'bone', { segments: 12, rings: 8 }), { t: [x, 0.045, behind + z] }));
    }
  }
  return [cranium, jaw, eyeL, eyeR, nose, ...parts];
}

function ghost() {
  const lift = 0.45;   // floats this far off the ground
  const profile = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    profile.push([Math.sin(a) * 0.3 + 0.0001, lift + 0.95 - (1 - Math.cos(a)) * 0.3]);
  }
  profile.reverse();          // from the hem up to the crown
  profile.unshift([0.36, lift]);
  const body = lathe(profile.reverse(), 36, 'ghost', {
    // A wavy hem
    yAt: (theta, i, y) => (i === profile.length - 1 ? y + 0.06 * Math.sin(theta * 6) : y),
  });
  const eyeL = place(sphere(0.045, 'socket', { squash: [1, 1.4, 0.6] }), { t: [-0.09, lift + 0.78, 0.27] });
  const eyeR = place(sphere(0.045, 'socket', { squash: [1, 1.4, 0.6] }), { t: [0.09, lift + 0.78, 0.27] });
  const mouth = place(sphere(0.04, 'socket', { squash: [1, 1.3, 0.6] }), { t: [0, lift + 0.62, 0.3] });
  return [body, eyeL, eyeR, mouth];
}

// ── glTF (.glb) writer ────────────────────────────────────────────────────

function normalsFor(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { normals[k] += nx; normals[k + 1] += ny; normals[k + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return normals;
}

function writeGlb(parts, file, materials = MATERIALS) {
  const materialNames = [...new Set(parts.map((p) => p.material))];
  const chunks = [];
  let offset = 0;
  const bufferViews = [], accessors = [], primitives = [];
  const addView = (array, target) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    chunks.push(bytes, new Uint8Array(pad));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += bytes.length + pad;
    return bufferViews.length - 1;
  };
  for (const part of parts) {
    const positions = new Float32Array(part.positions);
    const normals = normalsFor(positions, part.indices);
    const indices = positions.length / 3 > 65535 ? new Uint32Array(part.indices) : new Uint16Array(part.indices);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
    }
    accessors.push({ bufferView: addView(positions, 34962), componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max });
    const pos = accessors.length - 1;
    accessors.push({ bufferView: addView(normals, 34962), componentType: 5126, count: normals.length / 3, type: 'VEC3' });
    const nor = accessors.length - 1;
    accessors.push({ bufferView: addView(indices, 34963), componentType: indices instanceof Uint32Array ? 5125 : 5123, count: indices.length, type: 'SCALAR' });
    primitives.push({ attributes: { POSITION: pos, NORMAL: nor }, indices: accessors.length - 1, material: materialNames.indexOf(part.material) });
  }
  const gltf = {
    asset: { version: '2.0', generator: 'PoliAule scripts/build_season_models.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives }],
    materials: materialNames.map((name) => {
      const m = materials[name];
      return {
        name,
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [...m.color, 1], metallicFactor: 0, roughnessFactor: m.roughness },
        ...(m.emissive ? { emissiveFactor: m.emissive } : {}),
      };
    }),
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.length % 4)) % 4;
  json = Uint8Array.from([...json, ...new Array(jsonPad).fill(0x20)]);
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) { bin.set(c, at); at += c.length; }
  const total = 12 + 8 + json.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);   // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);  // "JSON"
  out.set(json, 20);
  view.setUint32(20 + json.length, bin.length, true);
  view.setUint32(24 + json.length, 0x004e4942, true);  // "BIN\0"
  out.set(bin, 28 + json.length);
  writeFileSync(file, out);
  return total;
}

mkdirSync(OUT_DIR, { recursive: true });
const nightMaterials = Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [k, { ...m, ...NIGHT[k] }]));
for (const [name, build] of Object.entries({ pumpkin, tombstone, skull, ghost })) {
  const bytes = writeGlb(build(), join(OUT_DIR, `${name}.glb`));
  console.log(`${name}.glb  ${(bytes / 1024).toFixed(1)} KB`);
  // The ones that glow at night get a version for it
  if (name === 'pumpkin' || name === 'ghost') {
    const night = writeGlb(build(), join(OUT_DIR, `${name}-night.glb`), nightMaterials);
    console.log(`${name}-night.glb  ${(night / 1024).toFixed(1)} KB`);
  }
}
