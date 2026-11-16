// textures.js — all art is procedural: canvas-painted textures (concrete, crate
// timber, corrugated steel, hazard stripes, asphalt, site markings) and a small
// set of shared MeshStandardMaterials in the game's dusk-harbor palette, so the
// map reads at a glance and no image is ever fetched.

import * as THREE from 'three';

function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Deterministic pattern noise (textures must not depend on Math.random at
// screenshot time; a tiny LCG keeps every build identical).
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function speckle(ctx, s, seed, n, colors, aMax) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(r() * colors.length) | 0];
    ctx.globalAlpha = 0.05 + r() * aMax;
    const w = 2 + r() * 14;
    ctx.fillRect(r() * s, r() * s, w, w * (0.4 + r()));
  }
  ctx.globalAlpha = 1;
}

export function makeMaterials() {
  const concrete = canvasTex(256, (x, s) => {
    x.fillStyle = '#8d9291'; x.fillRect(0, 0, s, s);
    speckle(x, s, 11, 900, ['#7c8280', '#9aa09e', '#6d7270'], 0.16);
    x.strokeStyle = 'rgba(40,44,44,0.35)'; x.lineWidth = 2;
    x.strokeRect(1, 1, s - 2, s - 2);
  }, 2);
  const asphalt = canvasTex(256, (x, s) => {
    x.fillStyle = '#4a4d52'; x.fillRect(0, 0, s, s);
    speckle(x, s, 23, 1600, ['#3c3f44', '#585b60', '#2f3236'], 0.2);
  }, 6);
  const timber = canvasTex(256, (x, s) => {
    x.fillStyle = '#9a6b3f'; x.fillRect(0, 0, s, s);
    const r = rng(7);
    for (let i = 0; i < 7; i++) {
      x.fillStyle = i % 2 ? '#8a5f36' : '#a57547';
      x.fillRect(0, (s / 7) * i, s, s / 7 - 2);
      x.strokeStyle = 'rgba(60,38,18,0.5)';
      for (let j = 0; j < 5; j++) { x.beginPath(); const y = (s / 7) * i + r() * s / 7; x.moveTo(0, y); x.bezierCurveTo(s * 0.3, y + 3, s * 0.6, y - 3, s, y); x.stroke(); }
    }
    x.strokeStyle = '#5e3d20'; x.lineWidth = 10; x.strokeRect(0, 0, s, s);
    x.beginPath(); x.moveTo(0, 0); x.lineTo(s, s); x.moveTo(s, 0); x.lineTo(0, s); x.stroke();
  });
  const steel = canvasTex(256, (x, s) => {
    x.fillStyle = '#5f7d84'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.10)'; x.fillRect((s / 16) * i, 0, s / 32, s); }
    speckle(x, s, 31, 200, ['#54707a', '#6b8a91', '#7d5a3a'], 0.14);
    x.fillStyle = 'rgba(30,36,38,0.55)'; x.fillRect(0, 0, s, 10); x.fillRect(0, s - 10, s, 10);
  });
  const hazard = canvasTex(128, (x, s) => {
    x.fillStyle = '#d8a022'; x.fillRect(0, 0, s, s);
    x.fillStyle = '#22252a';
    for (let i = -1; i < 3; i++) { x.beginPath(); x.moveTo(i * 64, s); x.lineTo(i * 64 + 32, s); x.lineTo(i * 64 + 96, 0); x.lineTo(i * 64 + 64, 0); x.fill(); }
  });
  const rust = canvasTex(256, (x, s) => {
    x.fillStyle = '#7a4a30'; x.fillRect(0, 0, s, s);
    speckle(x, s, 47, 1200, ['#8a5636', '#684026', '#96603c', '#59371f'], 0.25);
  });
  const M = (map, color, rough = 0.9, metal = 0.0) =>
    new THREE.MeshStandardMaterial({ map, color, roughness: rough, metalness: metal });
  const flat = (color, rough = 0.9, metal = 0.0) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  return {
    concrete: M(concrete, 0xbfc4c2),
    concreteDark: M(concrete, 0x767d7d),
    asphalt: M(asphalt, 0xa8abb0),
    sand: M(asphalt, 0xcdbb96),
    timber: M(timber, 0xd8b58e),
    steel: M(steel, 0xb9cdd2, 0.55, 0.55),
    steelBlue: M(steel, 0x7d9fc4, 0.55, 0.55),
    steelRust: M(rust, 0xc09a7a, 0.8, 0.2),
    hazard: M(hazard, 0xe8e8e8, 0.8),
    // flat palette accents: dusk teal + safety orange is the game's signature
    ink: flat(0x232a30, 0.85),
    teal: flat(0x2e6f79, 0.7, 0.1),
    orange: flat(0xd96c27, 0.65),
    cream: flat(0xe6ddc8, 0.9),
    siteA: flat(0xd96c27, 0.85),
    siteB: flat(0x2e8fa3, 0.85),
    atk: flat(0xd96c27, 0.75),        // Strikers: burnt orange
    atkDark: flat(0x8a4419, 0.85),
    def: flat(0x2e6f79, 0.75),        // Sentinels: harbor teal
    defDark: flat(0x1d454c, 0.85),
    skin: flat(0xc9976f, 0.7),
    dark: flat(0x14181c, 0.9),
    gunmetal: flat(0x2b3036, 0.45, 0.7),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fd4de, roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.5 }),
  };
}

// A painted ground decal texture (site letters, arrows) drawn once per label.
export function labelTexture(text, fg = '#f2ede2', bg = null, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, size, size); }
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `900 ${text.length > 2 ? size * 0.34 : size * 0.62}px Arial, sans-serif`;
  x.fillText(text, size / 2, size / 2 + size * 0.03);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
