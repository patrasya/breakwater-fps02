// weapons.js — the arsenal and the economy around it. Every gun is data: damage
// with distance falloff, spread that grows with movement and sustained fire,
// recoil, cycle time, magazine and reserve, price and kill reward. Accuracy is
// earned by stopping and crouching; the numbers below are the whole argument.

export const WEAPONS = {
  knife:   { name: 'Talon Knife', slot: 'melee', price: 0, dmg: 52, rpm: 150, range: 1.9, noise: 4, move: 1.06, auto: false },
  p9:      { name: 'P9 Sidearm', slot: 'secondary', price: 0, kind: 'pistol', dmg: 27, head: 4, rpm: 340, mag: 12, reserve: 96, reload: 1.5, spread: 0.011, spreadMove: 0.05, bloom: 0.010, recoil: 0.55, fallFrom: 18, fallTo: 42, fallMul: 0.55, pen: 0.6, noise: 26, move: 1.0, auto: false, killReward: 300 },
  kestrel: { name: 'Kestrel Pump', slot: 'primary', price: 1100, kind: 'shotgun', dmg: 15, head: 3, pellets: 8, rpm: 68, mag: 6, reserve: 32, reload: 2.9, spread: 0.055, spreadMove: 0.075, bloom: 0.02, recoil: 2.4, fallFrom: 7, fallTo: 20, fallMul: 0.3, pen: 0.4, noise: 30, move: 0.97, auto: false, killReward: 900 },
  vk9:     { name: 'VK-9 SMG', slot: 'primary', price: 1400, kind: 'smg', dmg: 22, head: 4, rpm: 780, mag: 30, reserve: 120, reload: 2.1, spread: 0.017, spreadMove: 0.055, bloom: 0.0075, recoil: 0.5, fallFrom: 14, fallTo: 34, fallMul: 0.5, pen: 0.55, noise: 28, move: 1.02, auto: true, killReward: 600 },
  vk7:     { name: 'VK-7 Carbine', slot: 'primary', price: 2700, kind: 'rifle', dmg: 33, head: 4, rpm: 620, mag: 30, reserve: 120, reload: 2.4, spread: 0.0075, spreadMove: 0.06, bloom: 0.0085, recoil: 0.85, fallFrom: 26, fallTo: 60, fallMul: 0.72, pen: 0.8, noise: 34, move: 0.98, auto: true, killReward: 300 },
  longbow: { name: 'Longbow DMR', slot: 'primary', price: 4500, kind: 'sniper', dmg: 108, head: 4, rpm: 42, mag: 5, reserve: 30, reload: 3.1, spread: 0.0008, spreadMove: 0.11, bloom: 0.004, recoil: 3.4, fallFrom: 60, fallTo: 120, fallMul: 0.9, pen: 1.0, noise: 44, move: 0.94, auto: false, killReward: 100, scoped: true },
};
export const NADES = {
  frag:  { name: 'Frag Grenade', price: 300, dmg: 92, radius: 6.5, color: 0x51603c },
  flash: { name: 'Flash Charge', price: 200, radius: 17, color: 0xd8dce2 },
  smoke: { name: 'Smoke Canister', price: 300, radius: 3.4, dur: 15, color: 0x9aa0a4 },
};
export const GEAR = {
  armor:  { name: 'Kevlar Vest', price: 650 },
  helmet: { name: 'Vest + Helmet', price: 1000 },
  kit:    { name: 'Defuse Kit', price: 200, defOnly: true },
};

// A loadout is the per-actor weapon state: owned guns with their own mag/reserve.
export function freshLoadout() {
  return {
    primary: null, secondary: gunState('p9'), melee: 'knife',
    nades: [],           // ordered list of nade ids still held
    armor: 0, helmet: false,
  };
}
export function gunState(id) {
  const w = WEAPONS[id];
  return { id, mag: w.mag, reserve: w.reserve, bloom: 0, nextT: 0 };
}
// What an actor drops on death / keeps on survival is handled by round.js.
export function priceOf(id) {
  if (WEAPONS[id]) return WEAPONS[id].price;
  if (NADES[id]) return NADES[id].price;
  if (GEAR[id]) return GEAR[id].price;
  return 0;
}
export function nameOf(id) {
  if (WEAPONS[id]) return WEAPONS[id].name;
  if (NADES[id]) return NADES[id].name;
  if (GEAR[id]) return GEAR[id].name;
  return id;
}
// Attempt a purchase for an actor; returns a refusal reason or null on success.
export function buyItem(a, id) {
  const L = a.loadout;
  const price = priceOf(id);
  if (a.money < price) return 'NOT ENOUGH CASH';
  if (WEAPONS[id]) {
    const slot = WEAPONS[id].slot;
    if (slot === 'melee' || slot === 'secondary') return 'ALREADY OWNED';
    L.primary = gunState(id);
    if (!['primary', 'secondary', 'melee'].includes(a.current) || a.current !== 'primary') a.current = 'primary';
  } else if (NADES[id]) {
    if (L.nades.includes(id)) return 'ALREADY CARRIED';
    if (L.nades.length >= 3) return 'GRENADE FULL';
    L.nades.push(id);
  } else if (id === 'armor') {
    if (L.armor >= 100) return 'ARMOR FULL';
    L.armor = 100;
  } else if (id === 'helmet') {
    if (L.armor >= 100 && L.helmet) return 'ARMOR FULL';
    L.armor = 100; L.helmet = true;
  } else if (id === 'kit') {
    if (a.team !== 'def') return 'SENTINELS ONLY';
    if (a.hasKit) return 'ALREADY OWNED';
    a.hasKit = true;
  } else return 'UNKNOWN ITEM';
  a.money -= price;
  return null;
}
