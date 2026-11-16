// The HUD: everything the player reads while playing, laid out as a
// quiet frame around the action — scoreboard top-left, clock top-centre,
// killfeed top-right, minimap bottom-left, vitals bottom-centre-left,
// weapon bottom-right, and full-screen washes (hurt vignette, flash
// white, scope) above it all. Match events arrive through g.events and
// are drained here once per frame; nothing else in the game touches DOM.

import { WEAPONS, GRENADES, ARMOR, currentSpread } from './weapons.js';
import { SOLIDS, SITES, siteAt } from './mapdata.js';

const $ = (id) => document.getElementById(id);

// The buy catalogue: one row per item, grouped. Descriptions are written
// for a first-time player who has never seen the yard.
const CATALOGUE = [
  { group: 'Long guns' },
  { id: 'gull', blurb: 'Gull M870 — pump shotgun, eight pellets, owns doorways' },
  { id: 'rook', blurb: 'Rook SMG — very fast, strong close, wild far' },
  { id: 'vandal', blurb: 'Vandal AR — full-auto rifle, the port standard' },
  { id: 'osprey', blurb: 'Osprey .338 — bolt-action, scoped, one-shot kills' },
  { group: 'Protection' },
  { id: 'vest', blurb: 'Kevlar vest — body shots do half damage' },
  { id: 'full', blurb: 'Vest + helmet — headshots hurt less too' },
  { group: 'Grenades' },
  { id: 'frag', blurb: 'Frag — clears corners, crates and plant spots' },
  { id: 'flash', blurb: 'Flashbang — blinds whoever is looking at it' },
  { id: 'smoke', blurb: 'Smoke — a 13-second wall nobody can see through' },
];

const priceOf = (id) => WEAPONS[id]?.price ?? ARMOR[id]?.price ?? GRENADES[id]?.price ?? 0;
const nameOf = (id) => WEAPONS[id]?.name ?? ARMOR[id]?.name ?? GRENADES[id]?.name ?? id;

const WEAPON_SHORT = { frag: 'FRAG', nightowl: 'P9', gull: 'M870', rook: 'SMG', vandal: 'AR', osprey: '.338' };
const ROUND_HOW = {
  elimination: 'by elimination',
  objective: 'the charge detonated',
  defuse: 'the charge was defused',
  time: 'time expired',
};

export function createHud(g) {
  const els = {
    hud: $('hud'), timer: $('timer'), roundLabel: $('round-label'), bombStatus: $('bomb-status'),
    scoreS: $('score-sentinel'), scoreR: $('score-runner'),
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

  // --- Buy menu: buttons are built once; affordability and ownership
  // are repainted live while the menu is open.
  const buyButtons = new Map();
  for (const row of CATALOGUE) {
    if (row.group) {
      const d = document.createElement('div');
      d.className = 'buy-cat';
      d.textContent = row.group;
      els.buyGrid.appendChild(d);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'buy-item';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = nameOf(row.id);
    const ds = document.createElement('span');
    ds.className = 'ds';
    ds.textContent = row.blurb;
    const pr = document.createElement('span');
    pr.className = 'pr';
    pr.textContent = `$${priceOf(row.id)}`;
    const own = document.createElement('span');
    own.className = 'own';
    b.append(nm, ds, pr, own);
    b.addEventListener('click', () => {
      if (g.match.buy(row.id)) g.audio.buy();
      else g.audio.deny();
      refreshBuy();
    });
    els.buyGrid.appendChild(b);
    buyButtons.set(row.id, b);
  }

  function refreshBuy() {
    const p = g.player;
    els.buyMoney.textContent = `$${p.money}`;
    for (const [id, b] of buyButtons) {
      let owned = '';
      let disabled = p.money < priceOf(id);
      if (WEAPONS[id]) {
        if (p.primary?.def.id === id) {
          owned = 'IN HAND';
          disabled = true;
        }
      } else if (id === 'vest') {
        if (p.armor) {
          owned = 'WORN';
          disabled = true;
        }
      } else if (id === 'full') {
        if (p.helmet) {
          owned = 'WORN';
          disabled = true;
        }
      } else if (GRENADES[id]) {
        const cap = id === 'flash' ? 2 : 1;
        if (p.grenades[id] >= cap) {
          owned = `MAX ${cap}`;
          disabled = true;
        } else if (p.grenades[id] > 0) {
          owned = `×${p.grenades[id]} CARRIED`;
        }
      }
      b.querySelector('.own').textContent = owned;
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
      // Back to the game: re-take the pointer (a canvas click also locks).
      try { g.input.lock(); } catch { /* fallback: the canvas click handler */ }
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
    const teamClass = (a) => (a.team === 'sentinel' ? 'sen' : 'run');
    const add = (text, cls) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      div.appendChild(s);
    };
    if (ev.killer) {
      add(ev.killer.name, teamClass(ev.killer));
      add(`${WEAPON_SHORT[ev.weapon] ?? ev.weapon}${ev.head ? ' ⌖ HEADSHOT' : ''}`, 'wpn');
    }
    add(ev.victim.name, teamClass(ev.victim));
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
        banner(
          g.match.overtime ? `OVERTIME ${g.match.otScore.sentinel + g.match.otScore.runner + 1}` : `ROUND ${ev.round}`,
          attacking ? 'Plant the charge — or eliminate the Sentinels' : 'Hold Pier 7 and Quay 3',
        );
        els.teamTag.textContent = attacking ? 'RUNNERS · plant the charge' : 'SENTINELS · defend the sites';
        if (p.alive) setBuy(true);
        break;
      }
      case 'live':
        setBuy(false);
        break;
      case 'halftime':
        banner('HALFTIME — SIDES SWITCH', `Sentinels ${ev.score.sentinel} · Runners ${ev.score.runner} — new roles, fresh $800`, 3.6);
        break;
      case 'overtime':
        banner('OVERTIME', 'Dead level after twelve — first to two rounds takes the port', 3.4);
        break;
      case 'kill':
        killfeed(ev);
        break;
      case 'planted':
        banner('CHARGE PLANTED', `${SITES[ev.site].name} · Site ${ev.site} — ${p.team === 'sentinel' ? 'retake and defuse' : 'guard it'}`);
        break;
      case 'defused':
        banner('CHARGE DEFUSED', '');
        break;
      case 'pickup':
        if (ev.actor.isPlayer) banner('CHARGE PICKED UP', 'Get to Pier 7 or Quay 3 and hold E');
        break;
      case 'roundEnd': {
        const won = ev.winner === p.team;
        banner(
          won ? 'ROUND WON' : 'ROUND LOST',
          `${ev.winner === 'sentinel' ? 'Sentinels' : 'Runners'} — ${ROUND_HOW[ev.how] ?? ''}`,
        );
        setBuy(false);
        break;
      }
      case 'matchEnd': {
        const won = ev.winner === p.team;
        els.endTitle.textContent = won ? 'THE PORT IS YOURS' : 'THE PORT IS LOST';
        els.endCopy.textContent = `Final score — Sentinels ${g.match.score.sentinel}, Runners ${g.match.score.runner}. Your line: ${p.kills} kills, ${p.deaths} deaths.`;
        els.endOverlay.hidden = false;
        setBuy(false);
        break;
      }
      default:
        break; // 'swap' is announced by the halftime banner
    }
  }

  function fmtClock(s) {
    const t = Math.max(0, Math.ceil(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  // The minimap: the yard from above, north up. Water along the west
  // edge, solids as blocks, sites as rings, friends as dots, the player
  // as a facing arrow, the charge as a red diamond when it is down.
  function drawMinimap() {
    const c = mapCtx;
    const S = 176 / 64;
    const px = (x) => (x + 32) * S;
    const pz = (z) => (z + 32) * S;
    c.fillStyle = '#10161d';
    c.fillRect(0, 0, 176, 176);
    c.fillStyle = '#16222c';
    c.fillRect(0, 0, px(-26), 176); // the waterline strip
    c.fillStyle = '#39434f';
    for (const s of SOLIDS) {
      if (s.y0 > 0.5) continue; // the dock canopy floats overhead; skip it
      c.fillRect(px(s.x0), pz(s.z0), (s.x1 - s.x0) * S, (s.z1 - s.z0) * S);
    }
    for (const s of Object.values(SITES)) {
      const col = s.id === 'A' ? '#e8b13c' : '#53b6c9';
      c.strokeStyle = col;
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(px(s.x), pz(s.z), s.r * S, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = col;
      c.font = 'bold 10px system-ui';
      c.textAlign = 'center';
      c.fillText(s.id, px(s.x), pz(s.z) + 3.5);
    }
    const bomb = g.match.bomb;
    if (bomb.state === 'planted' || bomb.state === 'dropped') {
      c.fillStyle = '#e5484d';
      c.save();
      c.translate(px(bomb.x), pz(bomb.z));
      c.rotate(Math.PI / 4);
      c.fillRect(-3.4, -3.4, 6.8, 6.8);
      c.restore();
    }
    for (const a of g.actors) {
      if (!a.alive || a.isPlayer || a.team !== g.player.team) continue;
      c.fillStyle = a.team === 'sentinel' ? '#6ea8d8' : '#e08a4c';
      c.beginPath();
      c.arc(px(a.x), pz(a.z), 2.6, 0, Math.PI * 2);
      c.fill();
    }
    const p = g.player;
    if (p.alive) {
      // Canvas x is world x, canvas y (down) is world z; the facing
      // vector is (-sin yaw, -cos yaw), drawn as an arrow.
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
      els.hitmarker.classList.toggle('head', !!head);
      hitUntil = g.time + (kill ? 0.32 : 0.16);
    },

    update() {
      const p = g.player;
      const m = g.match;
      const now = g.time;

      for (const ev of g.events.splice(0)) handleEvent(ev);

      if (bannerUntil && now > bannerUntil) {
        els.banner.classList.remove('show');
        bannerUntil = 0;
      }
      if (hitUntil && now > hitUntil) {
        els.hitmarker.style.opacity = '0';
        hitUntil = 0;
      }

      // Top bar: clock, round, scores.
      const left = m.clockLeft();
      els.timer.textContent = m.phase === 'idle' ? '—' : fmtClock(left);
      els.timer.classList.toggle('hot', m.bomb.state === 'planted' || (m.phase === 'live' && left < 10));
      els.roundLabel.textContent = m.overtime
        ? `Overtime · first to 2 (OT ${m.otScore.sentinel}–${m.otScore.runner})`
        : `Round ${Math.max(1, m.round)} of 12 · first to 7`;
      els.scoreS.querySelector('.num').textContent = m.score.sentinel;
      els.scoreR.querySelector('.num').textContent = m.score.runner;
      els.scoreS.querySelector('.alive').textContent = `${m.aliveCount('sentinel')} up`;
      els.scoreR.querySelector('.alive').textContent = `${m.aliveCount('runner')} up`;
      els.bombStatus.textContent =
        m.bomb.state === 'planted' ? `◆ PLANTED — ${m.bomb.site.name} · SITE ${m.bomb.site.id}` :
        m.bomb.state === 'dropped' ? '◆ CHARGE DROPPED' :
        m.carrier === p && m.phase === 'live' ? '◆ YOU CARRY THE CHARGE' : '';

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

      // Weapon cluster + live crosshair spread.
      const w = p.weapon();
      if (w) {
        els.weaponName.textContent = w.def.name;
        const mag = els.ammo.querySelector('.mag');
        mag.textContent = w.mag;
        mag.classList.toggle('empty', w.mag === 0);
        els.ammo.querySelector('.reserve').textContent = `/ ${w.reserve}`;
        els.reloadTag.textContent = p.reloading ? 'RELOADING…' : (w.mag === 0 ? 'PRESS R' : '');
        const spread = currentSpread(w.def, {
          speed: p.speed2d, grounded: p.grounded, crouched: p.crouched,
          scoped: g.scoped && !!w.def.scope, bloom: p.bloom,
        });
        els.crosshair.style.setProperty('--gap', `${Math.max(4, Math.min(30, 5 + spread * 620))}px`);
      }
      els.crosshair.style.opacity = (!p.alive || g.scoped || buyOpen) ? '0' : '1';
      els.grenades.innerHTML =
        `<span class="${p.grenades.frag ? '' : 'none'}">[3] Frag <b>${p.grenades.frag}</b></span>` +
        `<span class="${p.grenades.flash ? '' : 'none'}">[4] Flash <b>${p.grenades.flash}</b></span>` +
        `<span class="${p.grenades.smoke ? '' : 'none'}">[5] Smoke <b>${p.grenades.smoke}</b></span>`;

      // Context prompt + the plant/defuse channel bar.
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

      // Full-screen washes.
      const hurt = now < hurtUntil ? 0.55 : 0;
      const lowHp = p.alive && p.hp <= 35 ? 0.22 + 0.08 * Math.sin(now * 5) : 0;
      els.vignette.style.opacity = String(Math.max(hurt, lowHp));
      const blindLeft = Math.max(0, p.blindUntil - now);
      els.blind.style.opacity = String(Math.min(1, blindLeft / 1.1));
      els.scope.hidden = !g.scoped;

      // Buy upkeep: B toggles in the buy window; going live closes it.
      if (m.phase === 'buy' && g.input.wasPressed('KeyB')) setBuy(!buyOpen);
      if (buyOpen) {
        if (m.phase !== 'buy') {
          setBuy(false);
        } else {
          els.buyTimer.textContent = `Buy window — ${Math.ceil(m.clockLeft())}s left · B to close`;
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
