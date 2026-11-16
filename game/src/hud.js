// The HUD: every DOM element the player reads — timer, scores, vitals,
// ammo, killfeed, banners, minimap, buy menu and the full-screen effects
// (damage vignette, flash blindness, sniper scope). Match events arrive
// through g.events and are drained here once per frame.

import { WEAPONS, GRENADES, ARMOR, currentSpread } from './weapons.js';
import { SOLIDS, SITES, siteAt } from './mapdata.js';

const $ = (id) => document.getElementById(id);

const BUY_LAYOUT = [
  { cat: 'Primary weapons' },
  { id: 'gull', ds: 'Pump shotgun — 8 pellets, room-clearing' },
  { id: 'rook', ds: 'Fast SMG — strong up close, wild at range' },
  { id: 'vandal', ds: 'Full-auto rifle — the port standard' },
  { id: 'osprey', ds: 'Bolt-action .338 — one shot, scoped' },
  { cat: 'Gear' },
  { id: 'vest', ds: 'Kevlar vest — halves body damage' },
  { id: 'full', ds: 'Vest + helmet — headshots hurt less' },
  { cat: 'Grenades' },
  { id: 'frag', ds: 'Explosive — clears corners and sites' },
  { id: 'flash', ds: 'Blinds whoever looks at it' },
  { id: 'smoke', ds: 'Smoke wall — blocks sight for 13 s' },
];

function priceOf(id) {
  return WEAPONS[id]?.price ?? ARMOR[id]?.price ?? GRENADES[id]?.price ?? 0;
}
function nameOf(id) {
  return WEAPONS[id]?.name ?? ARMOR[id]?.name ?? GRENADES[id]?.name ?? id;
}

export function createHud(g) {
  const els = {
    hud: $('hud'), timer: $('timer'), roundLabel: $('round-label'), bombStatus: $('bomb-status'),
    scoreW: $('score-sentinel'), scoreJ: $('score-runner'),
    killfeed: $('killfeed'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    prompt: $('prompt'), channel: $('channel'), channelFill: $('channel-fill'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    teamTag: $('team-tag'), hpNum: $('hp-num'), armorTag: $('armor-tag'), hpFill: $('hp-fill'),
    money: $('money'), weaponName: $('weapon-name'), ammo: $('ammo'), reloadTag: $('reload-tag'),
    grenades: $('grenades'), deadTag: $('dead-tag'),
    vignette: $('vignette'), blind: $('blind'), scope: $('scope'),
    buyMenu: $('buy-menu'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'), buyTimer: $('buy-timer'),
    endOverlay: $('end-overlay'), endTitle: $('end-title'), endCopy: $('end-copy'),
  };
  const mapCtx = $('minimap').getContext('2d');

  let bannerUntil = 0;
  let hitUntil = 0;
  let lastHp = 100;
  let hurtUntil = 0;
  let buyOpen = false;
  let buyRefreshAt = 0;

  // --- Buy menu construction (buttons wired once, state refreshed live).
  const buyButtons = new Map();
  for (const row of BUY_LAYOUT) {
    if (row.cat) {
      const d = document.createElement('div');
      d.className = 'buy-cat';
      d.textContent = row.cat;
      els.buyGrid.appendChild(d);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'buy-item';
    b.innerHTML = `<span class="nm"></span><span class="ds"></span><span class="pr"></span> <span class="own"></span>`;
    b.querySelector('.nm').textContent = nameOf(row.id);
    b.querySelector('.ds').textContent = row.ds;
    b.querySelector('.pr').textContent = `$${priceOf(row.id)}`;
    b.addEventListener('click', () => {
      if (g.match.buy(row.id)) {
        g.audio.buy();
      } else {
        g.audio.deny();
      }
      refreshBuy();
    });
    els.buyGrid.appendChild(b);
    buyButtons.set(row.id, b);
  }

  function refreshBuy() {
    const p = g.player;
    els.buyMoney.textContent = `$${p.money}`;
    for (const [id, b] of buyButtons) {
      const own = b.querySelector('.own');
      let owned = '';
      let disabled = p.money < priceOf(id);
      if (WEAPONS[id]) {
        if (p.primary?.def.id === id) { owned = 'EQUIPPED'; disabled = true; }
      } else if (id === 'vest') {
        if (p.armor) { owned = 'OWNED'; disabled = true; }
      } else if (id === 'full') {
        if (p.helmet) { owned = 'OWNED'; disabled = true; }
      } else if (GRENADES[id]) {
        const cap = id === 'flash' ? 2 : 1;
        if (p.grenades[id] >= cap) { owned = `MAX (${cap})`; disabled = true; }
        else if (p.grenades[id] > 0) owned = `CARRYING ${p.grenades[id]}`;
      }
      own.textContent = owned;
      b.disabled = disabled;
    }
  }

  function setBuy(open) {
    buyOpen = open;
    els.buyMenu.hidden = !open;
    if (open) {
      refreshBuy();
      if (g.input.locked) g.input.unlock();
    } else if (!g.shotMode && g.match.phase !== 'idle' && g.match.phase !== 'matchEnd' && !g.input.locked) {
      // Back to the game: re-take the pointer (a click also re-locks).
      try { g.input.lock(); } catch { /* the canvas click fallback covers it */ }
    }
  }

  function banner(title, sub = '', dur = 2.6) {
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub;
    els.banner.classList.add('show');
    bannerUntil = g.time + dur;
  }

  function killfeed(ev) {
    const div = document.createElement('div');
    div.className = 'kill';
    const kc = ev.killer ? (ev.killer.team === 'sentinel' ? 'w' : 'j') : '';
    const vc = ev.victim.team === 'sentinel' ? 'w' : 'j';
    const wname = { frag: 'frag', nightowl: 'P9', gull: 'M870', rook: 'SMG', vandal: 'AR', osprey: '.338' }[ev.weapon] ?? ev.weapon;
    div.innerHTML = ev.killer
      ? `<span class="${kc}">${ev.killer.name}</span><span class="wpn">${wname}${ev.head ? ' <span class="hs">HEADSHOT</span>' : ''}</span><span class="${vc}">${ev.victim.name}</span>`
      : `<span class="${vc}">${ev.victim.name}</span>`;
    els.killfeed.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; }, 3600);
    setTimeout(() => { div.remove(); }, 4200);
    while (els.killfeed.children.length > 5) els.killfeed.firstChild.remove();
  }

  function handleEvent(ev) {
    const p = g.player;
    switch (ev.type) {
      case 'roundStart': {
        const attacking = p.team === 'runner';
        banner(`ROUND ${ev.round}`, attacking ? 'Plant the charge — or eliminate the Sentinels' : 'Defend the sites');
        els.teamTag.textContent = attacking ? 'Runners — plant the charge' : 'Sentinels — defend the sites';
        if (p.alive) setBuy(true);
        break;
      }
      case 'live':
        setBuy(false);
        break;
      case 'swap':
        banner('SIDES SWITCHED', 'Second half — new roles, fresh $800');
        break;
      case 'kill':
        killfeed(ev);
        break;
      case 'planted':
        banner('CHARGE PLANTED', `${SITES[ev.site].name} (Site ${ev.site}) — ${p.team === 'sentinel' ? 'defuse it' : 'guard it'}`);
        break;
      case 'defused':
        banner('CHARGE DEFUSED', '');
        break;
      case 'pickup':
        if (ev.actor.isPlayer) banner('CHARGE PICKED UP', 'Get to a site and hold E');
        break;
      case 'roundEnd': {
        const won = ev.winner === p.team;
        const howText = {
          elimination: 'by elimination',
          objective: 'the charge detonated',
          defuse: 'the charge was defused',
          time: 'time expired',
        }[ev.how] ?? '';
        banner(won ? 'ROUND WON' : 'ROUND LOST', `${ev.winner === 'sentinel' ? 'Sentinels' : 'Runners'} — ${howText}`);
        setBuy(false);
        break;
      }
      case 'matchEnd': {
        const won = ev.winner === p.team;
        els.endTitle.textContent = won ? 'THE PORT IS YOURS' : 'THE PORT IS LOST';
        els.endCopy.textContent = `Final score — Sentinels ${g.match.score.sentinel}, Runners ${g.match.score.runner}. Your record: ${p.kills} kills, ${p.deaths} deaths.`;
        els.endOverlay.hidden = false;
        setBuy(false);
        break;
      }
    }
  }

  function fmtClock(s) {
    s = Math.max(0, Math.ceil(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function drawMinimap() {
    const c = mapCtx;
    const S = 176 / 64;
    const px = (x) => (x + 32) * S;
    const pz = (z) => (z + 32) * S;
    c.fillStyle = '#141a21';
    c.fillRect(0, 0, 176, 176);
    c.fillStyle = '#39434f';
    for (const s of SOLIDS) {
      if (s.y0 > 0.5) continue; // skip the overhead canopy
      c.fillRect(px(s.x0), pz(s.z0), (s.x1 - s.x0) * S, (s.z1 - s.z0) * S);
    }
    for (const s of Object.values(SITES)) {
      c.strokeStyle = s.id === 'A' ? '#e8b13c' : '#53b6c9';
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(px(s.x), pz(s.z), s.r * S, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = c.strokeStyle;
      c.font = 'bold 10px system-ui';
      c.textAlign = 'center';
      c.fillText(s.id, px(s.x), pz(s.z) + 3.5);
    }
    const bomb = g.match.bomb;
    if (bomb.state === 'planted' || bomb.state === 'dropped') {
      c.fillStyle = '#e5484d';
      const bx = px(bomb.x);
      const bz = pz(bomb.z);
      c.save();
      c.translate(bx, bz);
      c.rotate(Math.PI / 4);
      c.fillRect(-3.4, -3.4, 6.8, 6.8);
      c.restore();
    }
    // Teammates as dots; the player as a facing arrow.
    for (const a of g.actors) {
      if (!a.alive || a.isPlayer || a.team !== g.player.team) continue;
      c.fillStyle = a.team === 'sentinel' ? '#6ea8d8' : '#e08a4c';
      c.beginPath();
      c.arc(px(a.x), pz(a.z), 2.6, 0, Math.PI * 2);
      c.fill();
    }
    const p = g.player;
    if (p.alive) {
      // Arrow drawn pointing +x, rotated to the player's facing: canvas x is
      // world x, canvas y (down) is world z, facing is (-sin yaw, -cos yaw).
      c.save();
      c.translate(px(p.x), pz(p.z));
      c.rotate(Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw)));
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.moveTo(5, 0);
      c.lineTo(-3.6, 3.2);
      c.lineTo(-3.6, -3.2);
      c.closePath();
      c.fill();
      c.restore();
    }
  }

  $('again').addEventListener('click', () => {
    els.endOverlay.hidden = true;
    g.startMatch();
  });

  return {
    els,
    banner,
    setBuy,
    get buyOpen() { return buyOpen; },
    hitmarker(head, kill) {
      els.hitmarker.style.opacity = '1';
      els.hitmarker.classList.toggle('kill', !!kill);
      hitUntil = g.time + (kill ? 0.32 : 0.16);
    },

    update(dt) {
      const p = g.player;
      const m = g.match;
      const now = g.time;

      for (const ev of g.events.splice(0)) handleEvent(ev);

      // Banner expiry.
      if (bannerUntil && now > bannerUntil) {
        els.banner.classList.remove('show');
        bannerUntil = 0;
      }
      if (hitUntil && now > hitUntil) {
        els.hitmarker.style.opacity = '0';
        hitUntil = 0;
      }

      // Top bar.
      const left = m.clockLeft();
      els.timer.textContent = m.phase === 'idle' ? '—' : fmtClock(left);
      els.timer.classList.toggle('hot', m.bomb.state === 'planted' || (m.phase === 'live' && left < 10));
      els.roundLabel.textContent = `Round ${Math.max(1, m.round)} · first to 7`;
      els.scoreW.querySelector('.num').textContent = m.score.sentinel;
      els.scoreJ.querySelector('.num').textContent = m.score.runner;
      els.scoreW.querySelector('.alive').textContent = `${m.aliveCount('sentinel')} alive`;
      els.scoreJ.querySelector('.alive').textContent = `${m.aliveCount('runner')} alive`;
      els.bombStatus.textContent =
        m.bomb.state === 'planted' ? `◆ CHARGE PLANTED — ${m.bomb.site.name} · SITE ${m.bomb.site.id}` :
        m.bomb.state === 'dropped' ? '◆ CHARGE DROPPED' :
        m.carrier === p && m.phase === 'live' ? '◆ YOU HAVE THE CHARGE' : '';

      // Vitals.
      if (p.hp < lastHp) hurtUntil = now + 0.45;
      lastHp = p.hp;
      els.hpNum.textContent = Math.ceil(p.hp);
      els.hpNum.classList.toggle('low', p.hp <= 35);
      els.hpFill.style.width = `${Math.max(0, p.hp)}%`;
      els.hpFill.classList.toggle('low', p.hp <= 35);
      els.armorTag.textContent = p.armor ? `◆ KEVLAR ${Math.ceil(p.armorHp)}${p.helmet ? ' + HELMET' : ''}` : '';
      els.money.textContent = `$${p.money}`;
      els.deadTag.hidden = p.alive || m.phase === 'idle';

      // Weapon box.
      const w = p.weapon();
      if (w) {
        els.weaponName.textContent = w.def.name;
        const mag = els.ammo.querySelector('.mag');
        mag.textContent = w.mag;
        mag.classList.toggle('empty', w.mag === 0);
        els.ammo.querySelector('.reserve').textContent = `/ ${w.reserve}`;
        els.reloadTag.textContent = p.reloading ? 'RELOADING…' : (w.mag === 0 ? 'PRESS R' : '');
        // Crosshair spread.
        const spread = currentSpread(w.def, {
          speed: p.speed2d, grounded: p.grounded, crouched: p.crouched,
          scoped: g.scoped && !!w.def.scope, bloom: p.bloom,
        });
        const gap = Math.max(4, Math.min(30, 5 + spread * 620));
        els.crosshair.style.setProperty('--gap', `${gap}px`);
      }
      els.crosshair.style.opacity = (!p.alive || g.scoped || buyOpen) ? '0' : '1';
      els.grenades.innerHTML =
        `<span class="${p.grenades.frag ? '' : 'none'}">[4] Frag <b>${p.grenades.frag}</b></span>` +
        `<span class="${p.grenades.flash ? '' : 'none'}">[5] Flash <b>${p.grenades.flash}</b></span>` +
        `<span class="${p.grenades.smoke ? '' : 'none'}">[6] Smoke <b>${p.grenades.smoke}</b></span>`;

      // Context prompt + channel bar.
      let prompt = '';
      if (p.alive && m.phase === 'live') {
        if (m.carrier === p && m.bomb.state === 'carried' && siteAt(p.x, p.z)) prompt = 'Hold <kbd>E</kbd> to plant the charge';
        else if (m.bomb.state === 'planted' && p.team === 'sentinel' && Math.hypot(p.x - m.bomb.x, p.z - m.bomb.z) < 2.3) prompt = 'Hold <kbd>E</kbd> to defuse';
        else if (m.bomb.state === 'dropped' && p.team === 'runner' && Math.hypot(p.x - m.bomb.x, p.z - m.bomb.z) < 3) prompt = 'Walk over the charge to pick it up';
      }
      els.prompt.hidden = !prompt;
      if (prompt) els.prompt.innerHTML = prompt;
      const ch = m.channel;
      if (ch && ch.actor === p) {
        els.channel.hidden = false;
        els.channelFill.style.width = `${Math.min(100, ((now - ch.start) / ch.dur) * 100)}%`;
      } else {
        els.channel.hidden = true;
      }

      // Full-screen effects.
      const hurt = now < hurtUntil ? 0.55 : 0;
      const lowHp = p.alive && p.hp <= 35 ? 0.22 + 0.08 * Math.sin(now * 5) : 0;
      els.vignette.style.opacity = String(Math.max(hurt, lowHp));
      const blindLeft = Math.max(0, p.blindUntil - now);
      els.blind.style.opacity = String(Math.min(1, blindLeft / 1.1));
      els.scope.hidden = !g.scoped;

      // Buy menu upkeep: B toggles during the buy phase; it closes itself
      // when the round goes live.
      if (m.phase === 'buy' && g.input.wasPressed('KeyB')) setBuy(!buyOpen);
      if (buyOpen) {
        if (m.phase !== 'buy') setBuy(false);
        else {
          els.buyTimer.textContent = `Buy phase — ${Math.ceil(m.clockLeft())}s left · B to close and play`;
          if (now > buyRefreshAt) {
            buyRefreshAt = now + 0.2;
            refreshBuy();
          }
        }
      }

      drawMinimap();
    },
  };
}
