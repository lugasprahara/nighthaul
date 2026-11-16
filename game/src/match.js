// The match: rounds, phases, economy, the breach charge, win checks and
// team plans. This module owns the rules; the player, bots and HUD only
// read its state and send it intents.
//
// Match shape: twelve regulation rounds, first to seven. The side swap
// at round 7 is a real phase of its own — 'halftime' freezes play for a
// few seconds while the teams trade ends and re-kit, so the swap reads
// as an event instead of a teleport. A 6–6 tie after round 12 goes to
// overtime: fresh money, first team to take two overtime rounds.

import { SPAWNS, SITES, siteAt } from './mapdata.js';
import { WEAPONS, GRENADES, ARMOR } from './weapons.js';
import { makeCharge } from './fx.js';
import { planRound } from './bots.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 105;
export const BOMB_TIME = 40;
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5;
export const WIN_SCORE = 7;
export const HALFTIME_SECONDS = 4;
export const OT_WIN_ROUNDS = 2;
export const OT_START_MONEY = 2500;

const otherTeam = (t) => (t === 'sentinel' ? 'runner' : 'sentinel');

export function createMatch(g) {
  const m = {
    phase: 'idle', // idle | buy | live | roundEnd | halftime | matchEnd
    phaseAt: 0,
    round: 0,
    score: { sentinel: 0, runner: 0 },
    losses: { sentinel: 0, runner: 0 },
    plan: { site: SITES.A },
    carrier: null,
    defuser: null,
    bomb: { state: 'carried', x: 0, z: 0, site: null, explodeAt: 0 },
    channel: null, // { actor, kind, start, dur, x, z }
    chargeMesh: null,
    lastBeep: 0,
    winner: null,
    swapped: false,
    overtime: false,
    otScore: { sentinel: 0, runner: 0 },
    otPending: false,

    start() {
      this.round = 0;
      this.score = { sentinel: 0, runner: 0 };
      this.losses = { sentinel: 0, runner: 0 };
      this.winner = null;
      this.swapped = false;
      this.overtime = false;
      this.otScore = { sentinel: 0, runner: 0 };
      this.otPending = false;
      for (const a of g.actors) {
        a.money = 800;
        a.kills = 0;
        a.deaths = 0;
        a.resetLoadout();
      }
      this.nextRound();
    },

    nextRound() {
      this.round += 1;

      // Halftime: the round-7 setup waits while the swap plays out.
      if (this.round === 7 && !this.swapped) {
        this.swapped = true;
        for (const a of g.actors) {
          a.team = otherTeam(a.team);
          a.money = 800;
          a.resetLoadout();
        }
        g.events.push({ type: 'swap' });
        g.events.push({ type: 'halftime', score: { ...this.score } });
        g.onTeamsChanged();
        this.phase = 'halftime';
        this.phaseAt = g.time;
        return;
      }
      this.setupRound();
    },

    setupRound() {
      this.phase = 'buy';
      this.phaseAt = g.time;
      this.channel = null;
      this.bomb = { state: 'carried', x: 0, z: 0, site: null, explodeAt: 0 };
      this.defuser = null;

      // Overtime opens with a clean kit and a fixed stake for everyone.
      if (this.otPending) {
        this.otPending = false;
        for (const a of g.actors) {
          a.money = OT_START_MONEY;
          a.resetLoadout();
        }
        g.events.push({ type: 'overtime' });
      }

      // The runners pick a site; one of them carries the charge.
      this.plan.site = Math.random() < 0.5 ? SITES.A : SITES.B;
      const runners = g.actors.filter((a) => a.team === 'runner');
      const sentinels = g.actors.filter((a) => a.team === 'sentinel');
      this.carrier = runners[Math.floor(Math.random() * runners.length)];

      // Spawns, facings and the death hook.
      for (const team of ['sentinel', 'runner']) {
        const list = team === 'sentinel' ? sentinels : runners;
        list.forEach((a, i) => {
          a.resetForRound(SPAWNS[team][i % SPAWNS[team].length], team === 'sentinel' ? 0 : Math.PI);
          a.onDeath = (victim, killer, info) => this.onKill(victim, killer, info);
        });
      }

      // Roles, holds and the execute plan come from the bot planner.
      for (const bot of g.bots) {
        bot.reset();
        bot.objective = null;
      }
      planRound(g);

      // The charge prop exists once and follows the carrier.
      if (!this.chargeMesh) {
        this.chargeMesh = makeCharge(g.mats);
        g.scene.add(this.chargeMesh);
      }
      this.chargeMesh.visible = true;

      // Bots shop for themselves; the player uses the buy menu.
      for (const bot of g.bots) this.botBuy(bot.actor);
      g.events.push({ type: 'roundStart', round: this.round });
    },

    botBuy(a) {
      // spend(need, price, ...): the bot only buys once it holds `need`,
      // then pays `price` — the rifle wants a buffer so a bot that buys
      // one can still afford armour after.
      const spend = (need, price, ok, apply) => {
        if (ok && a.money >= need) {
          a.money -= price;
          apply();
        }
      };
      const noPrimary = () => a.primary === null;
      const noArmor = () => !a.armor;
      // Rifle first, then the full kit, then the cheaper guns, then toys.
      spend(3700, WEAPONS.vandal.price, noPrimary(), () => { a.giveWeapon('vandal'); a.current = 'primary'; });
      spend(ARMOR.full.price, ARMOR.full.price, noArmor(), () => { a.armor = true; a.helmet = true; a.armorHp = 100; });
      spend(WEAPONS.rook.price, WEAPONS.rook.price, noPrimary(), () => { a.giveWeapon('rook'); a.current = 'primary'; });
      spend(WEAPONS.gull.price, WEAPONS.gull.price, noPrimary(), () => { a.giveWeapon('gull'); a.current = 'primary'; });
      spend(ARMOR.vest.price, ARMOR.vest.price, noArmor(), () => { a.armor = true; a.armorHp = 100; });
      spend(300, 300, a.grenades.frag === 0 && Math.random() < 0.6, () => { a.grenades.frag = 1; });
      spend(300, 300, a.grenades.smoke === 0 && Math.random() < 0.5, () => { a.grenades.smoke = 1; });
      spend(200, 200, a.grenades.flash === 0 && Math.random() < 0.5, () => { a.grenades.flash = 1; });
    },

    // The player's buy menu calls this. Returns true when the sale happened.
    buy(itemId) {
      const p = g.player;
      if (this.phase !== 'buy' || !p.alive) return false;
      const gun = WEAPONS[itemId];
      if (gun) {
        if (gun.slot === 'sidearm') return false; // the Nightowl is standard issue
        if (p.primary && p.primary.def.id === itemId) return false;
        if (p.money < gun.price) return false;
        p.money -= gun.price;
        p.giveWeapon(itemId);
        p.current = 'primary';
        g.view.setWeapon(gun);
        return true;
      }
      if (itemId === 'vest' || itemId === 'full') {
        const def = ARMOR[itemId];
        if (p.money < def.price) return false;
        if (itemId === 'vest' && p.armor) return false;
        if (itemId === 'full' && p.helmet) return false;
        p.money -= def.price;
        p.armor = true;
        p.armorHp = 100;
        if (itemId === 'full') p.helmet = true;
        return true;
      }
      const nade = GRENADES[itemId];
      if (nade) {
        const cap = itemId === 'flash' ? 2 : 1;
        if (p.grenades[itemId] >= cap || p.money < nade.price) return false;
        p.money -= nade.price;
        p.grenades[itemId] += 1;
        return true;
      }
      return false;
    },

    onKill(victim, killer, info) {
      if (killer && killer !== victim) killer.money = Math.min(16000, killer.money + 300);
      g.events.push({ type: 'kill', killer, victim, head: !!info.head, weapon: info.weapon ?? 'rifle' });
      if (victim === this.carrier && this.bomb.state === 'carried') {
        this.bomb.state = 'dropped';
        this.bomb.x = victim.x;
        this.bomb.z = victim.z;
      }
      if (this.channel && this.channel.actor === victim) this.channel = null;
    },

    // Sound events: enemy bots in earshot note the position, holders turn
    // toward it, and a sentinel holding the quiet site rotates when a
    // gunfight erupts at the other one — that rotation window is when
    // plants happen.
    noise(x, z, radius, source) {
      for (const bot of g.bots) {
        const a = bot.actor;
        if (!a.alive || a.team === source.team) continue;
        const d = Math.hypot(a.x - x, a.z - z);
        if (d > radius) continue;
        bot.heard = { x, z, at: g.time };
        if (bot.state !== 'hold') continue;
        bot.watchYaw = Math.atan2(-(x - a.x), -(z - a.z));
        if (radius >= 20 && a.team === 'sentinel') {
          for (const s of Object.values(SITES)) {
            const nearSite = Math.hypot(s.x - x, s.z - z) < 10;
            const farFromBot = Math.hypot(s.x - a.x, s.z - a.z) > 22;
            if (nearSite && farFromBot) {
              bot.rotateTo = s;
              bot.holdNode = null;
              bot.objective = null;
            }
          }
        }
      }
    },

    aliveCount(team) {
      return g.actors.filter((a) => a.team === team && a.alive).length;
    },

    endRound(winnerTeam, how) {
      this.phase = 'roundEnd';
      this.phaseAt = g.time;
      this.channel = null;
      this.score[winnerTeam] += 1;
      const loser = otherTeam(winnerTeam);
      this.losses[winnerTeam] = 0;
      this.losses[loser] += 1;

      // Economy: objective wins pay best; the loss bonus climbs with
      // consecutive losses so a shut-out half stays affordable.
      const winPay = how === 'objective' || how === 'defuse' ? 3000 : 2700;
      const lossPay = Math.min(2400, 1400 + (this.losses[loser] - 1) * 400);
      for (const a of g.actors) {
        a.money = Math.min(16000, a.money + (a.team === winnerTeam ? winPay : lossPay));
      }
      g.events.push({ type: 'roundEnd', winner: winnerTeam, how, round: this.round });
      if (winnerTeam === g.player.team) g.audio.roundWin();
      else g.audio.roundLose();

      // Match decision.
      if (this.overtime) {
        this.otScore[winnerTeam] += 1;
        if (this.otScore[winnerTeam] >= OT_WIN_ROUNDS) this.winner = winnerTeam;
      } else if (this.score.sentinel >= WIN_SCORE || this.score.runner >= WIN_SCORE) {
        this.winner = this.score.sentinel > this.score.runner ? 'sentinel' : 'runner';
      } else if (this.round >= 12) {
        if (this.score.sentinel === this.score.runner) {
          // Dead level after twelve: overtime, announced next round.
          this.overtime = true;
          this.otScore = { sentinel: 0, runner: 0 };
          this.otPending = true;
        } else {
          this.winner = this.score.sentinel > this.score.runner ? 'sentinel' : 'runner';
        }
      }
    },

    step(dt) {
      const now = g.time;
      const elapsed = now - this.phaseAt;
      this.placeChargeMesh(now);

      if (this.phase === 'buy' && elapsed >= BUY_TIME) {
        this.phase = 'live';
        this.phaseAt = now;
        g.events.push({ type: 'live' });
      }
      if (this.phase === 'live') this.stepLive();
      if (this.phase === 'halftime' && elapsed >= HALFTIME_SECONDS) this.setupRound();
      if (this.phase === 'roundEnd' && elapsed >= 4.5) {
        if (this.winner) {
          this.phase = 'matchEnd';
          this.phaseAt = now;
          g.events.push({ type: 'matchEnd', winner: this.winner });
          g.audio.matchEnd(this.winner === g.player.team);
          if (g.input.locked) g.input.unlock();
        } else {
          this.nextRound();
        }
      }
    },

    // The charge prop rides the carrier's back, sits where it drops, and
    // blinks faster and faster once planted.
    placeChargeMesh(now) {
      const mesh = this.chargeMesh;
      if (!mesh) return;
      const bomb = this.bomb;
      if (bomb.state === 'carried' && this.carrier) {
        const c = this.carrier;
        mesh.visible = c.alive;
        mesh.position.set(c.x + Math.sin(c.yaw) * 0.28, c.y + 1.05, c.z + Math.cos(c.yaw) * 0.28);
        mesh.rotation.y = c.yaw;
      } else if (bomb.state === 'dropped' || bomb.state === 'planted') {
        mesh.visible = true;
        mesh.position.set(bomb.x, 0, bomb.z);
        if (bomb.state === 'planted') {
          const left = bomb.explodeAt - now;
          const rate = left > 20 ? 1.0 : left > 10 ? 0.55 : left > 5 ? 0.3 : 0.16;
          if (now - this.lastBeep > rate) {
            this.lastBeep = now;
            g.audio.plantBeep(left < 1);
            mesh.userData.bulb.color.setHex(0xff3524);
          } else if (now - this.lastBeep > 0.07) {
            mesh.userData.bulb.color.setHex(0x541510);
          }
        }
      } else {
        mesh.visible = false;
      }
    },

    stepLive() {
      const now = g.time;
      const bomb = this.bomb;

      // Picking up a dropped charge.
      if (bomb.state === 'dropped') {
        for (const a of g.actors) {
          if (a.team === 'runner' && a.alive && Math.hypot(a.x - bomb.x, a.z - bomb.z) < 1.4) {
            bomb.state = 'carried';
            this.carrier = a;
            g.events.push({ type: 'pickup', actor: a });
            break;
          }
        }
      }

      // The defuser is always the nearest living sentinel to the charge.
      if (bomb.state === 'planted' && (!this.defuser || !this.defuser.alive)) {
        let best = null;
        let bestD = Infinity;
        for (const a of g.actors) {
          if (a.team !== 'sentinel' || !a.alive) continue;
          const d = Math.hypot(a.x - bomb.x, a.z - bomb.z);
          if (d < bestD) {
            bestD = d;
            best = a;
          }
        }
        this.defuser = best;
      }

      // Channels: whoever is holding the intent this tick — the player
      // with E, a bot with its intent flag — owns the channel.
      const intent = this.readIntent();
      if (intent) {
        if (!this.channel || this.channel.actor !== intent.actor || this.channel.kind !== intent.kind) {
          this.channel = {
            actor: intent.actor,
            kind: intent.kind,
            start: now,
            dur: intent.kind === 'plant' ? PLANT_TIME : DEFUSE_TIME,
            x: intent.actor.x,
            z: intent.actor.z,
          };
        }
        const ch = this.channel;
        if (Math.hypot(ch.actor.x - ch.x, ch.actor.z - ch.z) > 1.1 || !ch.actor.alive) {
          this.channel = null;
        } else if (now - ch.start >= ch.dur) {
          this.channel = null;
          if (ch.kind === 'plant') this.plantBomb(ch.actor);
          else this.defuseBomb(ch.actor);
        }
      } else {
        this.channel = null;
      }

      // Win checks.
      const sentinels = this.aliveCount('sentinel');
      const runners = this.aliveCount('runner');
      if (bomb.state === 'planted') {
        if (now >= bomb.explodeAt) {
          g.fx.explosion({ x: bomb.x, y: 0.6, z: bomb.z }, true);
          g.audio.explosion(1);
          bomb.state = 'gone';
          this.endRound('runner', 'objective');
          return;
        }
        if (sentinels === 0) {
          this.endRound('runner', 'elimination');
          return;
        }
      } else {
        if (runners === 0) {
          this.endRound('sentinel', 'elimination');
          return;
        }
        if (sentinels === 0) {
          this.endRound('runner', 'elimination');
          return;
        }
        if (now - this.phaseAt >= ROUND_TIME) {
          this.endRound('sentinel', 'time');
        }
      }
    },

    // Who is trying to plant or defuse right now?
    readIntent() {
      const bomb = this.bomb;
      if (bomb.state === 'carried' && this.carrier && this.carrier.alive) {
        const c = this.carrier;
        if (siteAt(c.x, c.z)) {
          if (c.isPlayer) {
            if (g.input.down('KeyE')) return { actor: c, kind: 'plant' };
          } else {
            const bot = g.bots.find((b) => b.actor === c);
            if (bot && bot.intent === 'plant') return { actor: c, kind: 'plant' };
          }
        }
      }
      if (bomb.state === 'planted') {
        for (const a of g.actors) {
          if (a.team !== 'sentinel' || !a.alive) continue;
          if (Math.hypot(a.x - bomb.x, a.z - bomb.z) > 2.3) continue;
          if (a.isPlayer) {
            if (g.input.down('KeyE')) return { actor: a, kind: 'defuse' };
          } else {
            const bot = g.bots.find((b) => b.actor === a);
            if (bot && bot.intent === 'defuse') return { actor: a, kind: 'defuse' };
          }
        }
      }
      return null;
    },

    plantBomb(actor) {
      const site = siteAt(actor.x, actor.z);
      if (!site) return;
      this.bomb.state = 'planted';
      this.bomb.x = actor.x;
      this.bomb.z = actor.z;
      this.bomb.site = site;
      this.bomb.explodeAt = g.time + BOMB_TIME;
      actor.money = Math.min(16000, actor.money + 300);
      this.defuser = null;
      g.audio.planted();
      g.events.push({ type: 'planted', site: site.id });
    },

    defuseBomb(actor) {
      this.bomb.state = 'gone';
      actor.money = Math.min(16000, actor.money + 300);
      g.audio.defused();
      g.events.push({ type: 'defused', actor });
      this.endRound('sentinel', 'defuse');
    },

    // Seconds left on the clock the HUD should show.
    clockLeft() {
      if (this.phase === 'buy') return BUY_TIME - (g.time - this.phaseAt);
      if (this.phase === 'halftime') return HALFTIME_SECONDS - (g.time - this.phaseAt);
      if (this.bomb.state === 'planted') return Math.max(0, this.bomb.explodeAt - g.time);
      if (this.phase === 'live') return Math.max(0, ROUND_TIME - (g.time - this.phaseAt));
      return 0;
    },
  };
  return m;
}
