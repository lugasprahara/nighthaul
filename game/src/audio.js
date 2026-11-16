// NIGHTHAUL's sound is 100% synthesis: no audio files exist. A small
// voice kit (oscillator blips and filtered noise hits with exponential
// envelopes) feeds a master compressor; a feedback-delay "harbour echo"
// send gives the big sounds — explosions, the plant/defuse stingers —
// the sense of a large hard-surfaced yard. Callers pass gains for
// distance; this module only shapes tone.

export function createAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();

  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -16;
  master.ratio.value = 5;
  const bus = ctx.createGain();
  bus.gain.value = 0.55;
  bus.connect(master);
  master.connect(ctx.destination);

  // Harbour echo: a short feedback delay on a send bus.
  const echo = ctx.createDelay(0.6);
  echo.delayTime.value = 0.19;
  const echoFb = ctx.createGain();
  echoFb.gain.value = 0.32;
  const echoWet = ctx.createGain();
  echoWet.gain.value = 0.2;
  echo.connect(echoFb).connect(echo);
  echo.connect(echoWet).connect(bus);

  // Shared white-noise source material.
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  // A filtered noise hit: the workhorse for gunfire, cloth, metal, air.
  function noiseHit({ at = 0, dur = 0.2, type = 'lowpass', freq = 1000, end = null, q = 0.8, gain = 0.5, echoSend = 0 }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (end !== null) f.frequency.exponentialRampToValueAtTime(Math.max(28, end), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0012, t + dur);
    src.connect(f).connect(g).connect(bus);
    if (echoSend > 0) {
      const send = ctx.createGain();
      send.gain.value = echoSend;
      g.connect(send).connect(echo);
    }
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // An oscillator blip with pitch glide: beeps, ticks, confirmation tones.
  function blip({ at = 0, freq = 440, glide = null, dur = 0.12, type = 'square', gain = 0.22, echoSend = 0 }) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide !== null) o.frequency.exponentialRampToValueAtTime(Math.max(18, glide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0012, t + dur);
    o.connect(g).connect(bus);
    if (echoSend > 0) {
      const send = ctx.createGain();
      send.gain.value = echoSend;
      g.connect(send).connect(echo);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // A short note ladder for round stingers.
  function ladder(notes, { step = 0.11, type = 'triangle', gain = 0.2, dur = 0.17 } = {}) {
    notes.forEach((f, i) => blip({ freq: f, dur, type, gain, at: i * step, echoSend: 0.25 }));
  }

  // Gunfire, voiced per weapon class: a snap transient over a chest thump.
  function shot(kind, gain = 1) {
    const v = {
      pistol: { snap: 2000, body: 640, dur: 0.15, level: 0.6 },
      smg: { snap: 2200, body: 720, dur: 0.12, level: 0.55 },
      rifle: { snap: 1750, body: 520, dur: 0.2, level: 0.75 },
      shotgun: { snap: 1500, body: 430, dur: 0.32, level: 0.9 },
      sniper: { snap: 2700, body: 480, dur: 0.5, level: 0.85 },
    }[kind] ?? { snap: 1750, body: 520, dur: 0.2, level: 0.75 };
    noiseHit({ dur: v.dur * 0.7, type: 'bandpass', freq: v.snap, end: v.snap * 0.22, q: 0.6, gain: v.level * gain, echoSend: 0.18 });
    noiseHit({ dur: v.dur, freq: v.body, end: 55, gain: v.level * gain });
    if (kind === 'sniper') blip({ freq: 130, glide: 38, dur: 0.3, type: 'triangle', gain: 0.4 * gain });
  }

  let ambientStarted = false;
  function ambient() {
    if (ambientStarted) return;
    ambientStarted = true;
    // Night water and wind against the hulls: looped noise through a
    // slowly wandering lowpass.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.value = 0.032;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(f.frequency);
    src.connect(f).connect(g).connect(bus);
    src.start();
    lfo.start();
  }

  return {
    ctx,
    resume() { if (ctx.state === 'suspended') ctx.resume(); },
    ambient,
    shot,
    dryFire() { blip({ freq: 1750, dur: 0.045, gain: 0.11 }); },
    reload() {
      // Mag out, mag in, bolt: three mechanical ticks.
      noiseHit({ dur: 0.05, type: 'bandpass', freq: 850, gain: 0.22 });
      noiseHit({ dur: 0.05, type: 'bandpass', freq: 560, gain: 0.26, at: 0.3 });
      blip({ freq: 300, dur: 0.05, gain: 0.16, at: 0.52 });
    },
    hit(head = false) {
      blip({ freq: head ? 1520 : 1020, dur: 0.06, type: 'sine', gain: 0.2 });
      if (head) blip({ freq: 2050, dur: 0.09, type: 'sine', gain: 0.14, at: 0.03 });
    },
    kill() { ladder([660, 990], { step: 0.07, dur: 0.13, gain: 0.18 }); },
    hurt() { noiseHit({ dur: 0.13, freq: 280, end: 85, gain: 0.38 }); },
    footstep(run = true) {
      noiseHit({ dur: 0.06, freq: run ? 470 : 350, end: 130, gain: run ? 0.09 : 0.045 });
    },
    jump() { noiseHit({ dur: 0.07, freq: 680, end: 280, gain: 0.05 }); },
    land() { noiseHit({ dur: 0.09, freq: 330, end: 95, gain: 0.13 }); },
    plantBeep(final = false) {
      blip({ freq: final ? 1560 : 1175, dur: final ? 0.22 : 0.08, type: 'sine', gain: 0.2, echoSend: 0.2 });
    },
    planted() { ladder([880, 1318], { step: 0.1, type: 'sine', gain: 0.2, dur: 0.16 }); },
    defused() { ladder([1318, 880], { step: 0.1, type: 'sine', gain: 0.2, dur: 0.18 }); },
    explosion(gain = 1) {
      noiseHit({ dur: 1.15, freq: 850, end: 38, gain: 0.95 * gain, echoSend: 0.5 });
      blip({ freq: 88, glide: 29, dur: 0.9, type: 'sine', gain: 0.65 * gain });
    },
    frag(gain = 1) {
      noiseHit({ dur: 0.55, freq: 1050, end: 55, gain: 0.78 * gain, echoSend: 0.4 });
      blip({ freq: 118, glide: 34, dur: 0.4, type: 'sine', gain: 0.48 * gain });
    },
    flashPop() {
      blip({ freq: 2350, glide: 2900, dur: 0.24, type: 'sine', gain: 0.26 });
      noiseHit({ dur: 0.18, type: 'highpass', freq: 2800, gain: 0.22 });
    },
    smokePop() { noiseHit({ dur: 0.5, type: 'bandpass', freq: 760, end: 190, gain: 0.18 }); },
    throwWhoosh() { noiseHit({ dur: 0.17, type: 'bandpass', freq: 880, end: 1550, gain: 0.09 }); },
    buy() { ladder([740, 1175], { step: 0.06, dur: 0.09, gain: 0.16 }); },
    deny() { blip({ freq: 210, dur: 0.12, gain: 0.17 }); },
    roundWin() { ladder([523, 659, 784], { step: 0.11, dur: 0.16, gain: 0.19 }); },
    roundLose() { ladder([392, 330, 262], { step: 0.12, dur: 0.18, gain: 0.19 }); },
    matchEnd(win) {
      ladder(win ? [523, 659, 784, 1046] : [440, 392, 330, 262], { step: 0.15, dur: 0.24, gain: 0.21 });
    },
  };
}
