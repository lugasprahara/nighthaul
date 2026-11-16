// The match: rounds, phases, economy, the breach charge (plant, defuse,
// explosion), win checks and team plans. This module owns the rules; the
// player, bots and HUD only read its state and send it intents.

import { SPAWNS, SITES, siteAt } from './mapdata.js';
import { WEAPONS, GRENADES, ARMOR } from './weapons.js';
import { makeCharge } from './fx.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 105;
export const BOMB_TIME = 40;
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5;
export const WIN_SCORE = 7;

const HOLD_PLAN = [
  { node: 'a_hold', yaw: 0.15 },
  { node: 'a_approach', yaw: -0.45 },
  { node: 'b_hold', yaw: 0.55 },
  { node: 'mid_hold', yaw: 0 },
];

export function createMatch(g) {
  const m = {
    phase: 'idle', // idle | buy | live | roundEnd | matchEnd
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

    start() {
      this.round = 0;
      this.score = { sentinel: 0, runner: 0 };
      this.losses = { sentinel: 0, runner: 0 };
      for (const a of g.actors) {
        a.money = 800;
        a.kills = 0;
        a.deaths = 0;
        a.resetLoadout();
      }
      this.nextRound();
    },

    nextRound() {
      this.round++;
      this.phase = 'buy';
      this.phaseAt = g.time;
      this.channel = null;
      this.bomb = { state: 'carried', x: 0, z: 0, site: null, explodeAt: 0 };
      this.defuser = null;

      // Side swap at half time: round 7 starts the second half.
      if (this.round === 7) {
        for (const a of g.actors) {
          a.team = a.team === 'sentinel' ? 'runner' : 'sentinel';
          a.money = 800;
          a.resetLoadout();
        }
        g.events.push({ type: 'swap' });
        g.onTeamsChanged();
      }

      // Team plan: the runners pick a site; one of them carries the charge.
      this.plan.site = Math.random() < 0.5 ? SITES.A : SITES.B;
      const runners = g.actors.filter((a) => a.team === 'runner');
      const sentinels = g.actors.filter((a) => a.team === 'sentinel');
      this.carrier = runners[Math.floor(Math.random() * runners.length)];

      // Spawns and facings.
      for (const team of ['sentinel', 'runner']) {
        const list = team === 'sentinel' ? sentinels : runners;
        list.forEach((a, i) => {
          a.resetForRound(SPAWNS[team][i % SPAWNS[team].length], team === 'sentinel' ? 0 : Math.PI);
          a.onDeath = (victim, killer, info) => this.onKill(victim, killer, info);
        });
      }

      // Bot assignments: sentinel holds, runner push/lurk roles.
      let hi = 0;
      for (const bot of g.bots) {
        bot.reset();
        const a = bot.actor;
        bot.objective = null;
        if (a.team === 'sentinel') {
          const plan = HOLD_PLAN[hi++ % HOLD_PLAN.length];
          bot.holdNode = plan.node;
          bot.watchYaw = plan.yaw;
        } else {
          bot.holdNode = null;
          bot.watchYaw = a === this.carrier ? 0 : Math.PI;
          bot.planRole = 'push';
        }
      }
      const runnerBots = g.bots.filter((b) => b.actor.team === 'runner' && b.actor !== this.carrier);
      if (runnerBots.length > 1) {
        const lurker = runnerBots[runnerBots.length - 1];
        lurker.planRole = 'lurk';
        lurker.lurkUntil = g.time + 26;
      }

      // Charge mesh follows the carrier.
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
      const buy = (check, apply) => { if (check()) apply(); };
      const hasPrimary = () => a.primary !== null;
      buy(() => a.money >= 3700 && !hasPrimary(), () => { a.money -= WEAPONS.vandal.price; a.giveWeapon('vandal'); a.current = 'primary'; });
      buy(() => a.money >= 1000 && !a.armor, () => { a.money -= ARMOR.full.price; a.armor = true; a.helmet = true; a.armorHp = 100; });
      buy(() => a.money >= 1250 && !hasPrimary(), () => { a.money -= WEAPONS.rook.price; a.giveWeapon('rook'); a.current = 'primary'; });
      buy(() => a.money >= 1100 && !hasPrimary(), () => { a.money -= WEAPONS.gull.price; a.giveWeapon('gull'); a.current = 'primary'; });
      buy(() => a.money >= 650 && !a.armor, () => { a.money -= ARMOR.vest.price; a.armor = true; a.armorHp = 100; });
      buy(() => a.money >= 300 && a.grenades.frag === 0 && Math.random() < 0.6, () => { a.money -= 300; a.grenades.frag = 1; });
      buy(() => a.money >= 300 && a.grenades.smoke === 0 && Math.random() < 0.5, () => { a.money -= 300; a.grenades.smoke = 1; });
      buy(() => a.money >= 200 && a.grenades.flash === 0 && Math.random() < 0.5, () => { a.money -= 200; a.grenades.flash = 1; });
    },

    // The player's buy menu calls this. Returns true when the sale happened.
    buy(itemId) {
      const p = g.player;
      if (this.phase !== 'buy' || !p.alive) return false;
      if (WEAPONS[itemId]) {
        const def = WEAPONS[itemId];
        if (def.slot === 'sidearm') return false; // the Nightowl is standard issue
        if (p.primary && p.primary.def.id === itemId) return false;
        if (p.money < def.price) return false;
        p.money -= def.price;
        p.giveWeapon(itemId);
        p.current = 'primary';
        g.view.setWeapon(def);
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
      if (GRENADES[itemId]) {
        const cap = itemId === 'flash' ? 2 : 1;
        if (p.grenades[itemId] >= cap) return false;
        if (p.money < GRENADES[itemId].price) return false;
        p.money -= GRENADES[itemId].price;
        p.grenades[itemId]++;
        return true;
      }
      return false;
    },

    onKill(victim, killer, info) {
      if (killer && killer !== victim) killer.money += 300;
      g.events.push({ type: 'kill', killer, victim, head: !!info.head, weapon: info.weapon ?? 'rifle' });
      if (victim === this.carrier && this.bomb.state === 'carried') {
        this.bomb.state = 'dropped';
        this.bomb.x = victim.x;
        this.bomb.z = victim.z;
      }
      if (this.channel && this.channel.actor === victim) this.channel = null;
    },

    // Sound events: bots on the other team turn toward nearby noise, and a
    // sentinel holding the quiet site rotates when a gunfight erupts at the
    // other one — that rotation window is when plants happen.
    noise(x, z, radius, source) {
      for (const bot of g.bots) {
        const a = bot.actor;
        if (!a.alive || a.team === source.team) continue;
        const d = Math.hypot(a.x - x, a.z - z);
        if (d > radius) continue;
        bot.heard = { x, z, at: g.time };
        if (bot.state === 'hold') {
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
      }
    },

    aliveCount(team) {
      return g.actors.filter((a) => a.team === team && a.alive).length;
    },

    endRound(winnerTeam, how) {
      this.phase = 'roundEnd';
      this.phaseAt = g.time;
      this.channel = null;
      this.score[winnerTeam]++;
      const loser = winnerTeam === 'sentinel' ? 'runner' : 'sentinel';
      this.losses[winnerTeam] = 0;
      this.losses[loser]++;

      // Economy.
      const winPay = how === 'objective' || how === 'defuse' ? 3000 : 2700;
      const lossPay = Math.min(2400, 1400 + (this.losses[loser] - 1) * 400);
      for (const a of g.actors) {
        if (a.team === winnerTeam) a.money += winPay;
        else a.money += lossPay;
        a.money = Math.min(16000, a.money);
      }
      g.events.push({ type: 'roundEnd', winner: winnerTeam, how, round: this.round });
      if (winnerTeam === g.player.team) g.audio.roundWin();
      else g.audio.roundLose();

      if (this.score.sentinel >= WIN_SCORE || this.score.runner >= WIN_SCORE || this.round >= 13) {
        this.winner = this.score.sentinel > this.score.runner ? 'sentinel' : 'runner';
      }
    },

    step(dt) {
      const now = g.time;
      const elapsed = now - this.phaseAt;

      // Charge mesh placement.
      if (this.chargeMesh) {
        if (this.bomb.state === 'carried' && this.carrier) {
          const c = this.carrier;
          this.chargeMesh.visible = c.alive;
          // On the carrier's back: behind their facing direction.
          this.chargeMesh.position.set(c.x + Math.sin(c.yaw) * 0.28, c.y + 1.05, c.z + Math.cos(c.yaw) * 0.28);
          this.chargeMesh.rotation.y = c.yaw;
        } else if (this.bomb.state === 'dropped') {
          this.chargeMesh.visible = true;
          this.chargeMesh.position.set(this.bomb.x, 0, this.bomb.z);
        } else if (this.bomb.state === 'planted') {
          this.chargeMesh.visible = true;
          this.chargeMesh.position.set(this.bomb.x, 0, this.bomb.z);
          // Beeps accelerate as the timer runs down; the light blinks along.
          const left = this.bomb.explodeAt - now;
          const rate = left > 20 ? 1.0 : left > 10 ? 0.55 : left > 5 ? 0.3 : 0.16;
          if (now - this.lastBeep > rate) {
            this.lastBeep = now;
            g.audio.plantBeep(left < 1);
            this.chargeMesh.userData.bulb.color.setHex(0xff3524);
          } else if (now - this.lastBeep > 0.07) {
            this.chargeMesh.userData.bulb.color.setHex(0x541510);
          }
        } else {
          this.chargeMesh.visible = false;
        }
      }

      if (this.phase === 'buy' && elapsed >= BUY_TIME) {
        this.phase = 'live';
        this.phaseAt = now;
        g.events.push({ type: 'live' });
      }

      if (this.phase === 'live') this.stepLive(dt);
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

    stepLive(dt) {
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

      // Defuser assignment: the nearest living sentinel to the planted charge.
      if (bomb.state === 'planted' && (!this.defuser || !this.defuser.alive)) {
        let best = null;
        let bd = Infinity;
        for (const a of g.actors) {
          if (a.team !== 'sentinel' || !a.alive) continue;
          const d = Math.hypot(a.x - bomb.x, a.z - bomb.z);
          if (d < bd) { bd = d; best = a; }
        }
        this.defuser = best;
      }

      // Channels: plant and defuse intents from bots and the player.
      let intent = null;
      if (bomb.state === 'carried' && this.carrier && this.carrier.alive) {
        const c = this.carrier;
        const site = siteAt(c.x, c.z);
        if (site) {
          if (c.isPlayer) {
            if (g.input.down('KeyE')) intent = { actor: c, kind: 'plant' };
          } else {
            const bot = g.bots.find((b) => b.actor === c);
            if (bot && bot.intent === 'plant') intent = { actor: c, kind: 'plant' };
          }
        }
      }
      if (bomb.state === 'planted') {
        for (const a of g.actors) {
          if (a.team !== 'sentinel' || !a.alive) continue;
          if (Math.hypot(a.x - bomb.x, a.z - bomb.z) > 2.3) continue;
          if (a.isPlayer) {
            if (g.input.down('KeyE')) intent = { actor: a, kind: 'defuse' };
          } else {
            const bot = g.bots.find((b) => b.actor === a);
            if (bot && bot.intent === 'defuse') intent = { actor: a, kind: 'defuse' };
          }
        }
      }

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
        // Moving away or dying breaks the channel (checked here and in onKill).
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
          return;
        }
      }
    },

    plantBomb(actor) {
      const site = siteAt(actor.x, actor.z);
      if (!site) return;
      this.bomb.state = 'planted';
      this.bomb.x = actor.x;
      this.bomb.z = actor.z;
      this.bomb.site = site;
      this.bomb.explodeAt = g.time + BOMB_TIME;
      actor.money += 300;
      this.defuser = null;
      g.audio.planted();
      g.events.push({ type: 'planted', site: site.id });
    },

    defuseBomb(actor) {
      this.bomb.state = 'gone';
      actor.money += 300;
      g.audio.defused();
      g.events.push({ type: 'defused', actor });
      this.endRound('sentinel', 'defuse');
    },

    // Seconds left on the clock the HUD should show.
    clockLeft() {
      if (this.phase === 'buy') return BUY_TIME - (g.time - this.phaseAt);
      if (this.bomb.state === 'planted') return Math.max(0, this.bomb.explodeAt - g.time);
      if (this.phase === 'live') return Math.max(0, ROUND_TIME - (g.time - this.phaseAt));
      return 0;
    },
  };
  return m;
}
