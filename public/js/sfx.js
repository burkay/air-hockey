// Web Audio ile sentezlenen ses efektleri (dosya yok, offline calisir).
// iOS Safari: AudioContext bir kullanici hareketinde acilmali -> unlock().

const Sfx = (() => {
  let ctx = null, master = null;
  const last = {};
  let muted = false;
  let primed = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
    return ctx;
  }

  // Context yeniden askiya alinmis olabilir; cal anindan once devam ettir.
  function wake(c) {
    if (c && c.state === 'suspended' && c.resume) c.resume();
  }

  // Her kullanici hareketinde cagrilir. iOS'ta resume() tek basina cogu
  // zaman yetmez: jest icinde tek-ornek sessiz buffer calmak ses
  // hattini gercekten acar (yoksa ses ancak buton tiklayinca gelir).
  function unlock() {
    const c = ensure();
    if (!c) return;
    wake(c);
    if (primed) return;
    primed = true;
    try {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch (e) {}
  }

  // ms cinsinden ayni sesi cok sik calma (spam engeli)
  function throttle(key, ms) {
    const now = performance.now();
    if (last[key] && now - last[key] < ms) return false;
    last[key] = now;
    return true;
  }

  function tone(freq, dur, type, vol, glide, delay) {
    const c = ensure();
    if (!c || muted) return;
    wake(c);
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(50, freq * glide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  function noise(dur, vol, hp) {
    const c = ensure();
    if (!c || muted) return;
    wake(c);
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 800;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }

  const semitone = (base, s) => base * Math.pow(2, s / 12);

  return {
    unlock,
    toggleMute() { muted = !muted; return muted; },
    isMuted() { return muted; },

    hit() { if (throttle('hit', 45)) tone(330, 0.09, 'square', 0.5, 0.55); },
    wall() { if (throttle('wall', 60)) tone(150, 0.07, 'triangle', 0.3, 0.7); },

    goal(scored) {
      const base = scored ? 523 : 300;
      const seq = scored ? [0, 4, 7, 12] : [0, -3, -7];
      seq.forEach((s, i) => tone(semitone(base, s), 0.16, 'sawtooth', 0.42, 0, i * 0.085));
      noise(0.12, 0.22, 1200);
    },

    win() {
      [0, 4, 7, 12, 16, 19].forEach((s, i) =>
        tone(semitone(440, s), 0.2, 'triangle', 0.5, 0, i * 0.13));
    },
    lose() {
      [0, -2, -5, -9].forEach((s, i) =>
        tone(semitone(330, s), 0.26, 'sawtooth', 0.4, 0, i * 0.17));
    }
  };
})();
