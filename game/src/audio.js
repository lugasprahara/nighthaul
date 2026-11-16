// All sound is synthesised with WebAudio: no audio files, nothing to load.
// One master chain, a shared noise buffer, and a function per game sound.
// Distances are handled by callers passing a gain (bots' shots are quieter).

export function createAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  function noise({ dur = 0.2, freq = 1200, q = 0.8, gain = 0.5, type = 'lowpass', sweepTo = null, at = 0 }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone({ freq = 440, dur = 0.12, gain = 0.25, type = 'square', slideTo = null, at = 0 }) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function shot(kind, gain = 1) {
    // A crack (band-passed noise) over a body thump (falling lowpass noise).
    if (kind === 'sniper') {
      noise({ dur: 0.5, freq: 2600, q: 0.4, gain: 0.85 * gain, type: 'bandpass', sweepTo: 300 });
      noise({ dur: 0.4, freq: 500, gain: 0.9 * gain, sweepTo: 60 });
      tone({ freq: 130, dur: 0.3, gain: 0.4 * gain, type: 'triangle', slideTo: 40 });
    } else if (kind === 'shotgun') {
      noise({ dur: 0.32, freq: 1500, q: 0.4, gain: 0.9 * gain, type: 'bandpass', sweepTo: 200 });
      noise({ dur: 0.3, freq: 420, gain: 0.9 * gain, sweepTo: 55 });
    } else if (kind === 'smg') {
      noise({ dur: 0.13, freq: 2100, q: 0.6, gain: 0.55 * gain, type: 'bandpass', sweepTo: 500 });
      noise({ dur: 0.12, freq: 700, gain: 0.55 * gain, sweepTo: 120 });
    } else if (kind === 'pistol') {
      noise({ dur: 0.16, freq: 1900, q: 0.6, gain: 0.6 * gain, type: 'bandpass', sweepTo: 420 });
      noise({ dur: 0.14, freq: 620, gain: 0.6 * gain, sweepTo: 100 });
    } else {
      // rifle
      noise({ dur: 0.2, freq: 1700, q: 0.5, gain: 0.75 * gain, type: 'bandpass', sweepTo: 320 });
      noise({ dur: 0.2, freq: 520, gain: 0.75 * gain, sweepTo: 70 });
    }
  }

  let ambientOn = false;
  function ambient() {
    if (ambientOn) return;
    ambientOn = true;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    src.connect(filter).connect(g).connect(master);
    src.start();
  }

  return {
    ctx,
    resume() { if (ctx.state === 'suspended') ctx.resume(); },
    ambient,
    shot,
    dryFire() { tone({ freq: 1900, dur: 0.04, gain: 0.12, type: 'square' }); },
    reload() {
      noise({ dur: 0.06, freq: 900, gain: 0.25, type: 'bandpass' });
      noise({ dur: 0.06, freq: 600, gain: 0.3, type: 'bandpass', at: 0.32 });
      tone({ freq: 320, dur: 0.05, gain: 0.18, type: 'square', at: 0.55 });
    },
    hit(head = false) {
      tone({ freq: head ? 1560 : 1050, dur: 0.06, gain: 0.22, type: 'sine' });
      if (head) tone({ freq: 2100, dur: 0.09, gain: 0.16, type: 'sine', at: 0.03 });
    },
    kill() {
      tone({ freq: 660, dur: 0.09, gain: 0.2, type: 'triangle' });
      tone({ freq: 990, dur: 0.14, gain: 0.2, type: 'triangle', at: 0.07 });
    },
    hurt() { noise({ dur: 0.14, freq: 300, gain: 0.4, sweepTo: 90 }); },
    footstep(run = true) {
      noise({ dur: 0.07, freq: run ? 500 : 380, gain: run ? 0.10 : 0.05, sweepTo: 140 });
    },
    jump() { noise({ dur: 0.08, freq: 700, gain: 0.06, sweepTo: 300 }); },
    land() { noise({ dur: 0.1, freq: 350, gain: 0.14, sweepTo: 100 }); },
    plantBeep(final = false) { tone({ freq: final ? 1560 : 1180, dur: final ? 0.22 : 0.08, gain: 0.22, type: 'sine' }); },
    planted() {
      tone({ freq: 880, dur: 0.1, gain: 0.22, type: 'sine' });
      tone({ freq: 1320, dur: 0.18, gain: 0.22, type: 'sine', at: 0.1 });
    },
    defused() {
      tone({ freq: 1320, dur: 0.1, gain: 0.22, type: 'sine' });
      tone({ freq: 880, dur: 0.2, gain: 0.22, type: 'sine', at: 0.1 });
    },
    explosion(gain = 1) {
      noise({ dur: 1.1, freq: 900, gain: 0.95 * gain, sweepTo: 40 });
      tone({ freq: 90, dur: 0.9, gain: 0.7 * gain, type: 'sine', slideTo: 30 });
    },
    frag(gain = 1) {
      noise({ dur: 0.55, freq: 1100, gain: 0.8 * gain, sweepTo: 60 });
      tone({ freq: 120, dur: 0.4, gain: 0.5 * gain, type: 'sine', slideTo: 35 });
    },
    flashPop() {
      tone({ freq: 2400, dur: 0.25, gain: 0.3, type: 'sine', slideTo: 3000 });
      noise({ dur: 0.2, freq: 3000, gain: 0.25, type: 'highpass' });
    },
    smokePop() { noise({ dur: 0.5, freq: 800, gain: 0.2, type: 'bandpass', sweepTo: 200 }); },
    throwWhoosh() { noise({ dur: 0.18, freq: 900, gain: 0.1, type: 'bandpass', sweepTo: 1600 }); },
    buy() {
      tone({ freq: 740, dur: 0.06, gain: 0.18, type: 'square' });
      tone({ freq: 1180, dur: 0.1, gain: 0.18, type: 'square', at: 0.06 });
    },
    deny() { tone({ freq: 220, dur: 0.12, gain: 0.18, type: 'square' }); },
    roundWin() {
      [523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.16, gain: 0.2, type: 'triangle', at: i * 0.11 }));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.18, gain: 0.2, type: 'triangle', at: i * 0.12 }));
    },
    matchEnd(win) {
      const seq = win ? [523, 659, 784, 1046] : [440, 392, 330, 262];
      seq.forEach((f, i) => tone({ freq: f, dur: 0.24, gain: 0.22, type: 'triangle', at: i * 0.15 }));
    },
  };
}
