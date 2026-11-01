// Builds the 3D models the seasonal decorations stand on the Campus map:
// public/models/halloween/{pumpkin,tombstone,skull,ghost}.glb (components/halloween.js),
// public/models/christmas/{tree,gifts,snowman}.glb (components/christmas.js)
// and public/models/easter/{egg,eggs,blossom}.glb (components/easter.js).
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

const MODELS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');

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
  // Christmas
  pine: { color: [0.11, 0.38, 0.2], roughness: 0.9 },
  pineDark: { color: [0.07, 0.28, 0.15], roughness: 0.9 },
  bark: { color: [0.36, 0.22, 0.12], roughness: 1 },
  gold: { color: [0.98, 0.76, 0.2], roughness: 0.35, emissive: [0.35, 0.25, 0.04] },
  baubleRed: { color: [0.85, 0.1, 0.12], roughness: 0.3 },
  baubleBlue: { color: [0.18, 0.4, 0.88], roughness: 0.3 },
  bulb: { color: [1.0, 0.92, 0.7], roughness: 1 },
  wrapRed: { color: [0.8, 0.12, 0.14], roughness: 0.7 },
  wrapGreen: { color: [0.12, 0.5, 0.3], roughness: 0.7 },
  wrapWhite: { color: [0.95, 0.95, 0.93], roughness: 0.7 },
  ribbon: { color: [0.97, 0.8, 0.3], roughness: 0.4 },
  ribbonRed: { color: [0.82, 0.08, 0.12], roughness: 0.4 },
  snow: { color: [0.97, 0.98, 1.0], roughness: 0.85 },
  coal: { color: [0.1, 0.1, 0.11], roughness: 1 },
  carrot: { color: [0.96, 0.48, 0.1], roughness: 0.8 },
  scarf: { color: [0.8, 0.12, 0.16], roughness: 0.9 },
  // Easter
  eggBlue: { color: [0.45, 0.68, 0.95], roughness: 0.35 },
  eggPink: { color: [0.97, 0.58, 0.74], roughness: 0.35 },
  eggYellow: { color: [0.98, 0.84, 0.38], roughness: 0.35 },
  eggMint: { color: [0.52, 0.86, 0.7], roughness: 0.35 },
  eggLilac: { color: [0.72, 0.58, 0.93], roughness: 0.35 },
  eggBand: { color: [0.99, 0.98, 0.95], roughness: 0.4 },
  eggBandRed: { color: [0.9, 0.24, 0.36], roughness: 0.4 },
  straw: { color: [0.86, 0.7, 0.34], roughness: 1 },
  blossomPink: { color: [0.98, 0.7, 0.82], roughness: 0.9 },
  blossomWhite: { color: [0.99, 0.92, 0.95], roughness: 0.9 },
  blossomDeep: { color: [0.9, 0.4, 0.62], roughness: 0.9 },
  blossomShade: { color: [0.74, 0.34, 0.52], roughness: 0.9 },
  blossomLight: { color: [1.0, 0.82, 0.9], roughness: 0.9 },
  barkDark: { color: [0.26, 0.17, 0.12], roughness: 1 },
  leafSpring: { color: [0.5, 0.76, 0.3], roughness: 0.9 },
};

// What changes for the models' night versions (<name>-night.glb)
const NIGHT = {
  pumpkin: { emissive: [0.95, 0.45, 0.08] },
  rib: { emissive: [0.8, 0.33, 0.04] },
  stem: { emissive: [0.16, 0.2, 0.08] },
  glow: { emissive: [1.0, 0.85, 0.35] },
  ghost: { emissive: [0.82, 0.88, 0.95] },
  // The tree's lights and star, lit; the tree itself only faintly, so its
  // shape still reads against the dark
  pine: { emissive: [0.03, 0.1, 0.05] },
  pineDark: { emissive: [0.02, 0.07, 0.04] },
  bark: { emissive: [0.06, 0.04, 0.02] },
  gold: { emissive: [1.0, 0.82, 0.3] },
  baubleRed: { emissive: [0.6, 0.06, 0.08] },
  baubleBlue: { emissive: [0.12, 0.26, 0.6] },
  bulb: { emissive: [1.0, 0.85, 0.5] },
  // The snowman and the gifts, as if under a street lamp: moonlit snow, and
  // the wrapping in its own colours, dimmed
  snow: { emissive: [0.72, 0.78, 0.9] },
  coal: { emissive: [0.05, 0.05, 0.06] },
  carrot: { emissive: [0.7, 0.32, 0.06] },
  scarf: { emissive: [0.6, 0.08, 0.1] },
  wrapRed: { emissive: [0.62, 0.08, 0.1] },
  wrapGreen: { emissive: [0.08, 0.38, 0.22] },
  wrapWhite: { emissive: [0.75, 0.75, 0.74] },
  ribbon: { emissive: [0.85, 0.66, 0.22] },
  ribbonRed: { emissive: [0.65, 0.05, 0.08] },
  // Easter: the eggs in their own colours, dimmed, and the blossom as if
  // under a street lamp, the trunk only faintly
  eggBlue: { emissive: [0.26, 0.4, 0.6] },
  eggPink: { emissive: [0.6, 0.32, 0.44] },
  eggYellow: { emissive: [0.62, 0.52, 0.2] },
  eggMint: { emissive: [0.3, 0.52, 0.42] },
  eggLilac: { emissive: [0.44, 0.34, 0.6] },
  eggBand: { emissive: [0.6, 0.6, 0.58] },
  eggBandRed: { emissive: [0.55, 0.14, 0.22] },
  straw: { emissive: [0.4, 0.32, 0.14] },
  blossomPink: { emissive: [0.6, 0.4, 0.5] },
  blossomWhite: { emissive: [0.62, 0.56, 0.6] },
  blossomDeep: { emissive: [0.6, 0.26, 0.4] },
  blossomShade: { emissive: [0.46, 0.2, 0.32] },
  blossomLight: { emissive: [0.66, 0.52, 0.58] },
  barkDark: { emissive: [0.08, 0.05, 0.04] },
  leafSpring: { emissive: [0.2, 0.32, 0.12] },
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

// ── Christmas ─────────────────────────────────────────────────────────────

// A five-pointed star standing upright (in the xy plane), centred on y = 0:
// the core and each point are convex, so each is its own extrusion
function star(r, depth, material) {
  const inner = r * 0.45;
  const at = (k, rr) => {
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  };
  const core = [];
  for (let k = 0; k < 10; k += 2) core.push(at(k + 1, inner));
  const parts = [extrude(core, depth, material)];
  for (let k = 0; k < 10; k += 2) parts.push(extrude([at(k - 1, inner), at(k + 1, inner), at(k, r)], depth * 0.8, material));
  return parts;
}

function tree() {
  // Three tiers of cones, each wider at the bottom with a little skirt, on a
  // short trunk, a star on top and baubles and lights hung round the tiers
  const parts = [cylinder(0.08, 0.25, 'bark', 10)];
  const tiers = [[0.62, 0.2, 0.62], [0.48, 0.58, 0.52], [0.34, 0.92, 0.46]];
  tiers.forEach(([r, y, h], i) => {
    const ribs = 9 + i * 2;
    parts.push(lathe([[0.0001, y - 0.02], [r, y], [r * 0.93, y + 0.05], [0.0001, y + h]], 36, i % 2 ? 'pineDark' : 'pine', {
      // A ragged hem: the cone's bottom edge rises and falls round it
      radiusAt: (theta, k) => (k === 1 ? 1 + 0.06 * Math.cos(theta * ribs) : 1),
    }));
  });
  const top = tiers[2][1] + tiers[2][2];
  parts.push(...star(0.13, 0.04, 'gold').map((p) => place(p, { t: [0, top + 0.08, 0] })));
  // Hangings: round each tier, a little above its hem, alternating baubles
  // and bulbs, turned so no two tiers line up
  const kinds = ['baubleRed', 'bulb', 'gold', 'bulb', 'baubleBlue', 'bulb'];
  let n = 0;
  tiers.forEach(([r, y, h], i) => {
    const count = 7 - i;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + i * 0.7;
      const yy = y + h * 0.22;
      const rr = r * (1 - 0.22) + 0.03;
      const kind = kinds[n++ % kinds.length];
      const size = kind === 'bulb' ? 0.035 : 0.055;
      parts.push(place(sphere(size, kind, { segments: 10, rings: 6 }), { t: [Math.cos(a) * rr, yy, Math.sin(a) * rr] }));
    }
  });
  return parts;
}

// An axis-aligned box from its size, standing on y = 0
function box(w, h, d, material) {
  return place(extrude([[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]], d, material), {});
}

function gift(w, h, d, wrap, ribbon) {
  const parts = [box(w, h, d, wrap)];
  // Ribbon bands round it both ways, a hair proud of the paper
  parts.push(box(w * 0.18, h + 0.01, d + 0.01, ribbon));
  parts.push(box(w + 0.01, h + 0.01, d * 0.18, ribbon));
  // The bow: two loops and a knot
  for (const s of [-1, 1]) {
    parts.push(place(sphere(w * 0.16, ribbon, { squash: [1.3, 0.75, 0.6], segments: 12, rings: 8 }), { rz: s * 0.5, t: [s * w * 0.15, h + w * 0.08, 0] }));
  }
  parts.push(place(sphere(w * 0.07, ribbon, { segments: 10, rings: 6 }), { t: [0, h + w * 0.04, 0] }));
  return parts;
}

function gifts() {
  // A small pile: a big one, a flat one leaning on it and a small one on top
  return [
    ...gift(0.42, 0.3, 0.42, 'wrapRed', 'ribbon').map((p) => place(p, { ry: 0.2, t: [-0.1, 0, 0] })),
    ...gift(0.3, 0.16, 0.36, 'wrapGreen', 'ribbonRed').map((p) => place(p, { ry: -0.5, t: [0.3, 0, 0.12] })),
    ...gift(0.22, 0.2, 0.22, 'wrapWhite', 'ribbonRed').map((p) => place(p, { ry: 0.9, t: [-0.08, 0.31, 0.02] })),
  ];
}

function snowman() {
  const parts = [
    place(sphere(0.3, 'snow', { squash: [1, 0.92, 1] }), { t: [0, 0.27, 0] }),
    place(sphere(0.22, 'snow'), { t: [0, 0.7, 0] }),
    place(sphere(0.16, 'snow'), { t: [0, 1.02, 0] }),
  ];
  // Coal eyes and buttons, a carrot nose, a scarf, a top hat
  for (const s of [-1, 1]) parts.push(place(sphere(0.022, 'coal', { segments: 8, rings: 6 }), { t: [s * 0.055, 1.07, 0.145] }));
  for (const [y, z] of [[0.62, 0.21], [0.74, 0.215], [0.4, 0.29]]) parts.push(place(sphere(0.025, 'coal', { segments: 8, rings: 6 }), { t: [0, y, z] }));
  parts.push(place(lathe([[0.03, 0], [0.0001, 0.17]], 10, 'carrot'), { rx: Math.PI / 2, t: [0, 1.02, 0.15] }));
  parts.push(place(lathe([[0.17, 0], [0.18, 0.03], [0.17, 0.07], [0.0001, 0.07]], 24, 'scarf'), { t: [0, 0.86, 0] }));
  parts.push(place(box(0.07, 0.24, 0.03, 'scarf'), { rz: 0.15, t: [0.1, 0.66, 0.15] }));
  parts.push(place(cylinder(0.17, 0.02, 'coal', 18), { t: [0, 1.14, 0] }));
  parts.push(place(cylinder(0.11, 0.17, 'coal', 18), { t: [0, 1.15, 0] }));
  parts.push(place(cylinder(0.112, 0.035, 'scarf', 18), { t: [0, 1.17, 0] }));
  return parts;
}

// ── Easter ────────────────────────────────────────────────────────────────

// An egg's silhouette: its radius at a height, widest a little below the middle
const EGG_T = (y, h) => Math.acos(1 - (2 * y) / h);
const eggRadius = (y, h, r) => { const t = EGG_T(y, h); return r * Math.sin(t) * (1 + 0.14 * Math.cos(t)); };

// An egg `h` tall and `r` across at its widest, standing on y = 0. Bands round
// it are slightly proud of its shell: [y0, y1] as fractions of its height.
function egg(h, r, shell, bands = []) {
  const profile = [];
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const y = (i / n) * h;
    profile.push([Math.max(0.0001, eggRadius(y, h, r)), y]);
  }
  const parts = [lathe(profile, 20, shell)];
  for (const [f0, f1, material] of bands) {
    const band = [];
    const m = 5;
    for (let i = 0; i <= m; i++) {
      const y = (f0 + (f1 - f0) * (i / m)) * h;
      band.push([eggRadius(y, h, r) * 1.015, y]);
    }
    parts.push(lathe(band, 20, material));
  }
  return parts;
}

// Grows parts about the origin, so a small egg reads from campus zoom
function scaled(parts, k) {
  for (const part of parts) for (let i = 0; i < part.positions.length; i++) part.positions[i] *= k;
  return parts;
}

// A single big egg, tilted a little in a nest of straw
function eggModel() {
  const parts = [
    lathe([[0.0001, 0], [0.14, 0.01], [0.25, 0.04], [0.27, 0.08], [0.22, 0.1], [0.14, 0.06], [0.0001, 0.04]], 24, 'straw', {
      radiusAt: (theta, i) => 1 + 0.05 * Math.sin(theta * 7 + i),
    }),
  ];
  const big = egg(0.56, 0.21, 'eggPink', [[0.3, 0.38, 'eggBand'], [0.5, 0.58, 'eggBandRed'], [0.7, 0.76, 'eggBand']]);
  // A row of dots on the red band
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const y = 0.32, rr = eggRadius(y, 0.56, 0.21) * 1.02;
    big.push(place(sphere(0.014, 'eggBand', { segments: 6, rings: 4 }), { t: [Math.cos(a) * rr, y, Math.sin(a) * rr] }));
  }
  parts.push(...big.map((p) => place(p, { rz: 0.1, t: [0, 0.07, 0] })));
  return scaled(parts, 1.7);
}

// A nest with three small eggs of different colours
function eggsModel() {
  const parts = [
    lathe([[0.0001, 0], [0.16, 0.01], [0.28, 0.04], [0.31, 0.09], [0.25, 0.11], [0.17, 0.06], [0.0001, 0.04]], 24, 'straw', {
      radiusAt: (theta, i) => 1 + 0.06 * Math.sin(theta * 6 + i * 1.3),
    }),
  ];
  const set = [
    ['eggBlue', [-0.11, 0.06, 0.05], 0.15, [[0.4, 0.5, 'eggBand']]],
    ['eggYellow', [0.12, 0.06, 0.0], -0.2, [[0.55, 0.65, 'eggBandRed']]],
    ['eggMint', [0.0, 0.06, -0.13], 0.3, [[0.3, 0.38, 'eggBand'], [0.62, 0.7, 'eggBand']]],
  ];
  for (const [shell, t, tilt, bands] of set) {
    parts.push(...egg(0.36, 0.135, shell, bands).map((p) => place(p, { rz: tilt, ry: tilt * 3, t })));
  }
  return scaled(parts, 1.7);
}

// A low-poly blob, flat-shaded like Mapbox's own trees: an icosahedron (once
// subdivided unless `detail` is 0) with every vertex pushed in or out a little, each face with its
// own vertices (so each face gets its own normal), `squash` flattening it.
function blob(r, material, rand, { jitter = 0.2, squash = [1, 0.8, 1], detail = 1 } = {}) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // Subdivide once, new points on the unit sphere
  const mid = new Map();
  const midpoint = (i, j) => {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`;
    if (!mid.has(key)) {
      const [x, y, z] = verts[i].map((v, k) => (v + verts[j][k]) / 2);
      const l = Math.hypot(x, y, z);
      verts.push([x / l, y / l, z / l]);
      mid.set(key, verts.length - 1);
    }
    return mid.get(key);
  };
  if (detail > 0) {
    faces = faces.flatMap(([a, b, c]) => {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  verts = verts.map(([x, y, z]) => {
    const k = 1 + (rand() - 0.5) * 2 * jitter;
    return [x * k * squash[0] * r, y * k * squash[1] * r, z * k * squash[2] * r];
  });
  const positions = [], indices = [];
  for (const [a, b, c] of faces) {
    const [pa, pb, pc] = [verts[a], verts[b], verts[c]];
    // Wound to face away from the blob's middle
    const n = [(pb[1] - pa[1]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[1] - pa[1]), (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]), (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])];
    const outward = n[0] * (pa[0] + pb[0] + pc[0]) + n[1] * (pa[1] + pb[1] + pc[1]) + n[2] * (pa[2] + pb[2] + pc[2]) > 0;
    const base = positions.length / 3;
    for (const p of outward ? [pa, pb, pc] : [pa, pc, pb]) positions.push(...p);
    indices.push(base, base + 1, base + 2);
  }
  return { positions, indices, material };
}

// A small seeded random, so the tree is the same every time it's built
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A flat, irregular disc lying on the ground
function scatter(r, y, material, rand, sides = 9) {
  const positions = [0, y, 0], indices = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const rr = r * (0.75 + rand() * 0.3);
    positions.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
  }
  for (let i = 0; i < sides; i++) indices.push(0, 1 + ((i + 1) % sides), 1 + i);
  return { positions, indices, material };
}

// A cherry tree in blossom, low and wide like the trees round it on the map:
// a dark trunk leaning a little, forking into four branches that reach up and
// out under a flat-topped crown of faceted clusters, pink above and a deeper
// pink underneath, a few small white ones catching the light on top, and
// petals scattered on the ground.
function blossomModel() {
  const rand = seeded(7);
  const parts = [];
  // The trunk, leaning
  const lean = 0.09, forkAt = 0.42;
  parts.push(place(lathe([[0.0001, 0], [0.085, 0], [0.07, 0.15], [0.052, forkAt], [0.0001, forkAt]], 7, 'barkDark'), { rz: lean }));
  const fork = [-Math.sin(lean) * forkAt, Math.cos(lean) * forkAt, 0];
  // Four thick branches, reaching up and out
  [[0.2, 0.8, 0.5], [1.75, 0.65, 0.46], [3.3, 0.75, 0.5], [4.9, 0.6, 0.42]].forEach(([az, tilt, len]) => {
    const limb = lathe([[0.0001, 0], [0.05, 0], [0.026, len], [0.0001, len]], 6, 'barkDark');
    parts.push(place(place(limb, { rz: tilt }), { ry: az, t: fork }));
    // A twig off each
    const twig = lathe([[0.0001, 0], [0.022, 0], [0.012, len * 0.5], [0.0001, len * 0.5]], 5, 'barkDark');
    const at = [fork[0] + Math.sin(tilt) * Math.cos(az) * len * 0.5, fork[1] + Math.cos(tilt) * len * 0.5, fork[2] - Math.sin(tilt) * Math.sin(az) * len * 0.5];
    parts.push(place(place(twig, { rz: tilt + 0.7 }), { ry: az + 0.5, t: at }));
  });
  // The crown: faceted clusters over a shallow dome, wider than tall; the
  // lower ones round the rim and the underside are the deeper pink
  const N = 17, R = 0.6, baseY = 0.64, domeH = 0.22;
  for (let i = 0; i < N; i++) {
    const a = i * 2.39996;
    const f = Math.sqrt((i + 0.6) / N);
    const x = Math.cos(a) * f * R, z = Math.sin(a) * f * R;
    const y = baseY + domeH * (1 - f * f) + (rand() - 0.5) * 0.05;
    const r = 0.2 - f * 0.035 + (rand() - 0.5) * 0.04;
    const underneath = f > 0.72 || y < baseY + domeH * 0.35;
    const material = underneath ? (i % 2 ? 'blossomShade' : 'blossomDeep') : (i % 4 === 0 ? 'blossomDeep' : 'blossomPink');
    parts.push(place(blob(r, material, rand, { squash: [1.08, 0.72, 1.08], detail: underneath ? 0 : 1 }), { ry: rand() * 6, t: [x, y, z] }));
  }
  // Highlights: small pale clusters on top of the dome
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.4, f = 0.18 + (i % 3) * 0.17;
    parts.push(place(blob(0.085, 'blossomWhite', rand, { jitter: 0.15, detail: 0 }), { t: [Math.cos(a) * f * R, baseY + domeH * (1 - f * f) + 0.15, Math.sin(a) * f * R] }));
  }
  // Petals on the ground: a pink drift under the tree and a few strays
  parts.push(scatter(0.52, 0.004, 'blossomLight', rand, 11));
  parts.push(place(scatter(0.3, 0.006, 'blossomPink', rand, 8), { t: [0.1, 0, -0.08] }));
  for (let k = 0; k < 14; k++) {
    const a = k * 2.4 + 0.3, d = 0.35 + (k % 5) * 0.12;
    parts.push(place(scatter(0.045, 0.008, k % 3 ? 'blossomLight' : 'blossomWhite', rand, 5), { t: [Math.cos(a) * d, 0, Math.sin(a) * d] }));
  }
  return parts;
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

const nightMaterials = Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [k, { ...m, ...NIGHT[k] }]));
// Per season: its models, and the ones that glow at night (they get a
// <name>-night version)
const SEASONS = {
  halloween: { models: { pumpkin, tombstone, skull, ghost }, night: ['pumpkin', 'ghost'] },
  christmas: { models: { tree, gifts, snowman }, night: ['tree', 'gifts', 'snowman'] },
  easter: { models: { egg: eggModel, eggs: eggsModel, blossom: blossomModel }, night: ['egg', 'eggs', 'blossom'] },
};
for (const [season, { models, night }] of Object.entries(SEASONS)) {
  const dir = join(MODELS_DIR, season);
  mkdirSync(dir, { recursive: true });
  for (const [name, build] of Object.entries(models)) {
    const bytes = writeGlb(build(), join(dir, `${name}.glb`));
    console.log(`${season}/${name}.glb  ${(bytes / 1024).toFixed(1)} KB`);
    if (night.includes(name)) {
      const lit = writeGlb(build(), join(dir, `${name}-night.glb`), nightMaterials);
      console.log(`${season}/${name}-night.glb  ${(lit / 1024).toFixed(1)} KB`);
    }
  }
}
