// hud.js — everything drawn over the 3D world: crosshair that breathes with
// your real spread, hitmarker, health/armor/money, magazine, round clock and
// score, kill feed, damage direction, flash and scope overlays, the buy menu,
// the scoreboard, and the banners that narrate the round. It only reads game
// state and writes DOM — the sim never waits on it.

import { G, CFG, TEAM, clamp } from './state.js';
import { WEAPONS, NADES, GEAR, buyItem, nameOf, priceOf } from './weapons.js';
import { curGun, curWeaponDef, spreadOf } from './combat.js';
import { input } from './input.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const els = {};
const BUY_LIST = ['vk7', 'vk9', 'kestrel', 'longbow', 'armor', 'helmet', 'frag', 'flash', 'smoke'];
let feedSeen = 0, buyMsg = '', buyMsgT = 0;

export function initHud() {
  for (const id of ['hp', 'armor', 'money', 'ammo', 'weapon', 'timer', 'score', 'phase', 'feed', 'banner', 'bannerSub',
    'hitmark', 'crosshair', 'vignette', 'dmgdir', 'flash', 'scope', 'channel', 'channelBar', 'buymenu', 'buyitems',
    'board', 'menu', 'menuTitle', 'menuSub', 'spectate', 'planted', 'money2', 'roundnum'])
    els[id] = $(id);
  buildBuyMenu();
}
function buildBuyMenu() {
  els.buyitems.innerHTML = BUY_LIST.map((id, i) =>
    `<div class="buyrow" id="buy-${id}"><span class="bk">${i + 1}</span><span class="bn">${nameOf(id)}</span><span class="bp">$${priceOf(id)}</span><span class="bo"></span></div>`).join('');
}
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`; }

export function updateHud() {
  const a = G.player; if (!a) return;
  const alive = a.alive;
  // vitals
  els.hp.textContent = Math.max(0, Math.ceil(a.hp));
  els.hp.style.color = a.hp <= 30 ? '#ff5a4a' : '#f2ede2';
  els.armor.textContent = a.loadout.armor > 0 ? `🛡 ${Math.ceil(a.loadout.armor)}` : '';
  els.money.textContent = `$${a.money}`;
  // weapon & ammo
  const gun = curGun(a), def = curWeaponDef(a);
  if (a.current === 'melee') { els.weapon.textContent = 'TALON KNIFE'; els.ammo.textContent = '—'; }
  else if (a.current === 'nade') { els.weapon.textContent = nameOf(a.loadout.nades[0]) || 'GRENADE'; els.ammo.textContent = `${a.loadout.nades.length} held`; }
  else if (gun) {
    els.weapon.textContent = def.name + (a.reloadT > 0 ? ' — RELOADING' : '');
    els.ammo.innerHTML = `<b>${gun.mag}</b> / ${gun.reserve}`;
  }
  // clock & score
  const planted = G.bomb.state === 'planted';
  els.timer.textContent = G.phase === 'buy' ? fmtTime(G.timer) : planted ? fmtTime(G.bomb.timer) : G.phase === 'live' ? fmtTime(G.timer) : '';
  els.timer.style.color = planted ? '#ff5a4a' : (G.phase === 'live' && G.timer < 11) ? '#ffb36b' : '#f2ede2';
  els.score.innerHTML = `<span class="atk">${G.score.atk}</span> — <span class="def">${G.score.def}</span>`;
  els.roundnum.textContent = `ROUND ${G.round} / ${CFG.maxRounds} · FIRST TO ${CFG.winTarget}`;
  els.phase.textContent = G.phase === 'buy' ? 'BUY PHASE' : planted ? 'CHARGE PLANTED' : G.phase === 'live' ? (a.hasBomb ? 'YOU HAVE THE CHARGE' : '') : '';
  els.planted.style.opacity = planted ? (0.55 + 0.45 * Math.sin(G.time * 6)) : 0;
  // crosshair breathes with true spread; hitmarker flashes on contact
  if (alive && G.phase !== 'buy') {
    els.crosshair.style.opacity = a.adsT > 0.75 && def?.scoped ? 0 : 1;
    const px = gun ? clamp(spreadOf(a, def) * 620, 3, 46) : 6;
    els.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
  } else els.crosshair.style.opacity = 0;
  const hm = G.time - (G.hitmarkT || -9);
  els.hitmark.style.opacity = hm < 0.22 ? 1 : 0;
  els.hitmark.style.color = G.hitmarkKill ? '#ff5a4a' : '#f2ede2';
  // damage feedback: vignette + direction wedge toward the shooter
  const recent = G.time - (a.dmgFromT || -9) < 0.7 && a.dmgFrom;
  const lowHp = alive && a.hp <= 35;
  els.vignette.style.opacity = recent ? 0.85 : lowHp ? 0.45 + 0.15 * Math.sin(G.time * 4) : 0;
  if (recent) {
    const k = a.dmgFrom;
    const ang = Math.atan2(-(k.pos.x - a.pos.x), -(k.pos.z - a.pos.z));
    let rel = ang - a.yaw; while (rel > Math.PI) rel -= Math.PI * 2; while (rel < -Math.PI) rel += Math.PI * 2;
    els.dmgdir.style.opacity = 1;
    els.dmgdir.style.transform = `translate(-50%,-50%) rotate(${-rel}rad)`;
  } else els.dmgdir.style.opacity = 0;
  els.flash.style.opacity = clamp(a.blindT / 3.2, 0, 1);
  els.scope.style.opacity = def?.scoped && a.adsT > 0.75 ? 1 : 0;
  els.spectate.style.opacity = !alive && G.phase !== 'matchover' ? 1 : 0;
  // channel progress (planting / defusing)
  if (a.channel) {
    els.channel.style.opacity = 1;
    els.channel.firstElementChild.textContent = a.channel.type === 'plant' ? 'PLANTING THE CHARGE…' : 'DEFUSING…';
    els.channelBar.style.width = `${(a.channel.t / a.channel.need) * 100}%`;
  } else els.channel.style.opacity = 0;
  // banners
  if (G.banner && G.time - G.banner.t < 3.4) {
    els.banner.textContent = G.banner.title; els.bannerSub.textContent = G.banner.sub || '';
    const k = clamp((G.time - G.banner.t) / 0.3, 0, 1) * clamp((3.4 - (G.time - G.banner.t)) / 0.5, 0, 1);
    els.banner.style.opacity = k; els.bannerSub.style.opacity = k;
  } else { els.banner.style.opacity = 0; els.bannerSub.style.opacity = 0; }
  // kill feed (rebuild only when it changes)
  if (G.feed.length !== feedSeen) {
    feedSeen = G.feed.length;
    els.feed.innerHTML = G.feed.slice(-5).map((f) => `<div class="feedrow ${f.team === TEAM.ATK ? 'atkf' : 'deff'}">${f.text}</div>`).join('');
  }
  // buy menu: visible through the buy phase; digits buy instantly
  const buying = G.phase === 'buy' && alive;
  els.buymenu.style.display = buying ? 'block' : 'none';
  if (buying) {
    BUY_LIST.forEach((id, i) => {
      const row = document.getElementById('buy-' + id);
      const afford = a.money >= priceOf(id);
      const owned = (WEAPONS[id] && a.loadout.primary?.id === id) || (NADES[id] && a.loadout.nades.includes(id)) ||
        (id === 'armor' && a.loadout.armor >= 100 && !a.loadout.helmet) || (id === 'helmet' && a.loadout.helmet);
      row.className = 'buyrow' + (owned ? ' owned' : afford ? '' : ' poor');
      row.querySelector('.bo').textContent = owned ? 'OWNED' : afford ? '' : '—';
      if (input.pressed['Digit' + (i + 1)]) {
        const err = buyItem(a, id);
        if (err) { buyMsg = err; buyMsgT = G.time; sfx.deny(); }
        else { buyMsg = `BOUGHT ${nameOf(id)}`; buyMsgT = G.time; sfx.buy(); }
      }
    });
    els.money2.textContent = `$${a.money}` + (G.time - buyMsgT < 2 ? ` · ${buyMsg}` : '');
  }
  // scoreboard on Tab
  if (input.keys['Tab']) {
    els.board.style.display = 'block';
    const row = (x) => `<tr class="${x.alive ? '' : 'dead'}"><td>${x.name}${x.isPlayer ? ' (you)' : ''}${x.hasBomb ? ' ●' : ''}</td><td>${x.kills}</td><td>${x.deaths}</td><td>$${x.money}</td></tr>`;
    els.board.innerHTML = `<h3>BREAKWATER — ROUND ${G.round}</h3>
      <div class="atk">STRIKERS ${G.score.atk}</div><table>${G.actors.filter((x) => x.team === TEAM.ATK).map(row).join('')}</table>
      <div class="def">SENTINELS ${G.score.def}</div><table>${G.actors.filter((x) => x.team === TEAM.DEF).map(row).join('')}</table>`;
  } else els.board.style.display = 'none';
}
export function showMenu(title, sub) {
  els.menu.style.display = 'flex';
  els.menuTitle.textContent = title; els.menuSub.innerHTML = sub;
}
export function hideMenu() { els.menu.style.display = 'none'; }
