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

  // --- Mac sonu melodileri (MIDI tarzi, ozgun; dosya yok) ---
  // Nota: [vurus, MIDI no, uzunluk(vurus)]. Davul: [vurus, 'k' kick | 's' trampet | 'c' zil].
  const SONGS = {
    // Do major, sicrayan motif -> dominant -> parlak kapanis
    win: {
      bpm: 148, tracks: [
        { wave: 'square', vol: 0.20, cut: 3200, notes: [[0,72,.45],[.5,76,.22],[.75,79,.22],[1,84,.7],[1.75,81,.22],[2,83,.45],[2.5,79,.45],[3,81,.45],[3.5,77,.22],[3.75,79,.22],[4,76,.45],[4.5,74,.45],[5,79,.45],[5.5,83,.45],[6,84,1.9]] },
        { wave: 'triangle', vol: 0.20, notes: [[0,64,.9],[1,67,.9],[2,67,.9],[3,65,.9],[4,67,.9],[5,65,.9],[6,76,1.9],[6,79,1.9]] },
        { wave: 'triangle', vol: 0.42, notes: [[0,48,.9],[1,48,.9],[2,43,.9],[3,41,.9],[4,48,.9],[5,43,.9],[6,36,.9],[7,48,.9]] },
        { wave: 'sine', vol: 0.16, notes: [[6.25,88,.25],[6.5,91,.25],[6.75,96,.25],[7,100,.8]] }
      ],
      drums: [[0,'k'],[1,'s'],[2,'k'],[2.5,'k'],[3,'s'],[4,'k'],[5,'s'],[5.5,'s'],[5.75,'s'],[6,'k'],[6,'c']]
    },
    // La minor, inen hat; son nota asagi kayar
    lose: {
      bpm: 100, tracks: [
        { wave: 'triangle', vol: 0.34, vib: 5, notes: [[0,76,.45],[.5,74,.45],[1,72,.9],[2,71,.45],[2.5,69,.45],[3,68,.9],[4,69,.45],[4.5,64,.45],[5,57,1.5,-3]] },
        { wave: 'sine', vol: 0.20, notes: [[0,60,1.9],[0,64,1.9],[2,57,.9],[2,65,.9],[3,56,.9],[3,62,.9],[4,57,2.4],[4,60,2.4]] },
        { wave: 'triangle', vol: 0.40, notes: [[0,45,.9],[1,45,.9],[2,41,.9],[3,40,.9],[4,45,.9],[5,33,1.5]] }
      ],
      drums: [[0,'k'],[2,'k'],[4,'k'],[5,'k']]
    },
    // Acik biten kisa cumle: ne sevinc ne huzun
    draw: {
      bpm: 120, tracks: [
        { wave: 'square', vol: 0.15, cut: 2200, notes: [[0,72,.45],[.5,74,.45],[1,72,.45],[1.5,67,.45],[2,69,1.4]] },
        { wave: 'triangle', vol: 0.36, notes: [[0,48,.9],[1,53,.9],[2,50,1.4]] },
        { wave: 'sine', vol: 0.18, notes: [[0,64,.9],[1,65,.9],[2,65,1.4]] }
      ],
      drums: [[0,'k'],[1,'s'],[2,'k']]
    }
  };
  let music = null;          // calan melodi: { bus, timer }
  function stopMusic() {
    if (!music || !ctx) return;
    const m = music; music = null;
    clearTimeout(m.timer);
    try {
      m.bus.gain.cancelScheduledValues(ctx.currentTime);
      m.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
      setTimeout(() => { try { m.bus.disconnect(); } catch (e) {} }, 400);
    } catch (e) {}
  }
  function playSong(name, delay) {
    stopMusic();
    const c = ensure();
    if (!c || muted) return;
    wake(c);
    const song = SONGS[name], beat = 60 / song.bpm, t0 = c.currentTime + (delay || 0) + 0.02;
    const bus = c.createGain(), comp = c.createDynamicsCompressor();
    bus.gain.value = 1.15;
    bus.connect(comp); comp.connect(master);
    let end = 0;
    song.tracks.forEach((tr) => {
      let out = bus;
      if (tr.cut) {                       // kare dalganin sertligini al
        out = c.createBiquadFilter();
        out.type = 'lowpass'; out.frequency.value = tr.cut;
        out.connect(bus);
      }
      tr.notes.forEach(([b, n, len, fall]) => {
        const t = t0 + b * beat, d = len * beat, f = 440 * Math.pow(2, (n - 69) / 12);
        const o = c.createOscillator(), g = c.createGain();
        o.type = tr.wave;
        o.frequency.setValueAtTime(f, t);
        if (fall) o.frequency.exponentialRampToValueAtTime(f * Math.pow(2, fall / 12), t + d);
        if (tr.vib) {
          const l = c.createOscillator(), lg = c.createGain();
          l.frequency.value = tr.vib; lg.gain.value = f * 0.008;
          l.connect(lg); lg.connect(o.frequency);
          l.start(t); l.stop(t + d + 0.1);
        }
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(tr.vol, t + 0.012);
        g.gain.setValueAtTime(tr.vol, t + Math.max(0.012, d * 0.45));
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + d + 0.08);
        end = Math.max(end, t + d);
      });
    });
    song.drums.forEach(([b, kind]) => drum(c, bus, t0 + b * beat, kind));
    music = { bus, timer: setTimeout(() => { if (music && music.bus === bus) music = null; }, (end - c.currentTime + 1) * 1000) };
  }
  function drum(c, out, t, kind) {
    const g = c.createGain();
    g.connect(out);
    if (kind === 'k') {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.55, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); o.start(t); o.stop(t + 0.18);
      return;
    }
    const dur = kind === 'c' ? 0.9 : 0.12;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), f = c.createBiquadFilter();
    s.buffer = buf; f.type = 'highpass'; f.frequency.value = kind === 'c' ? 5200 : 1800;
    g.gain.setValueAtTime(kind === 'c' ? 0.16 : 0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); s.start(t);
  }

  const semitone = (base, s) => base * Math.pow(2, s / 12);

  return {
    unlock,
    toggleMute() { muted = !muted; return muted; },
    setMuted(m) { muted = !!m; if (muted) stopMusic(); },
    isMuted() { return muted; },

    hit() { if (throttle('hit', 45)) tone(330, 0.09, 'square', 0.5, 0.55); },
    wall() { if (throttle('wall', 60)) tone(150, 0.07, 'triangle', 0.3, 0.7); },

    goal(scored) {
      const base = scored ? 523 : 300;
      const seq = scored ? [0, 4, 7, 12] : [0, -3, -7];
      seq.forEach((s, i) => tone(semitone(base, s), 0.16, 'sawtooth', 0.42, 0, i * 0.085));
      noise(0.12, 0.22, 1200);
    },

    // Mac sonu: gol sesi bitsin diye biraz gecikmeli baslar
    win() { playSong('win', 0.4); },
    lose() { playSong('lose', 0.4); },
    draw() { playSong('draw', 0.2); },
    stopMusic
  };
})();
