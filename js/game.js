// Air Hockey cekirdegi: fizik + cizim + ag senkronizasyonu.
// Model: HOST yetkili. Host fizigi calistirir ve durumu misafire yollar.
// Misafir kendi paddle'ini aninda hareket ettirir, geri kalanini yumusatarak cizer.

const Game = (() => {
  // --- Sanal masa olculeri (dikey) ---
  const W = 100;          // masa genisligi
  const H = 200;          // masa yuksekligi
  let PR = 3.2;           // puck yaricapi (kucuk/orta/buyuk ile degisir)
  const MR = 8.5;         // paddle yaricapi (telefonda parmaktan buyuk: Pro Max'te ~65px cap)
  const PUCK_SIZES = { small: 2.4, med: 3.2, large: 4.4 };
  function setPuckSize(n) { PR = PUCK_SIZES[n] || PUCK_SIZES.med; }
  const GOAL_W = 38;      // kale acikligi
  const WALL_E = 0.90;    // ray (duvar) restitution'i - bir miktar enerji kaybi
  const PADDLE_E = 0.80;  // puck-mallet restitution'i
  // Surtunme: yavaslama (birim/sn^2) = DRAG_C + DRAG_1*v + DRAG_2*v^2
  //  sabit kisim yavas puck'i durdurur, v^2 kismi sert vurusu hizla dizginler
  const DRAG_C = 3, DRAG_1 = 0.08, DRAG_2 = 0.0007;
  // Hiz tavani YUMUSAK: KNEE'ye kadar aynen, sonra tavana yaklasarak sikisir
  // (sert vurus HER ZAMAN daha hizli; eskiden 240'ta kesilip hepsi esitti).
  const SPD_KNEE = 170;
  const SPD_CAP_AI = 360;   // tek kisilik
  const SPD_CAP_NET = 290;  // cok oyunculu: hiz x gecikme hatasi paddle'i asmasin
  function spdCap() { return ai ? SPD_CAP_AI : SPD_CAP_NET; }
  // Paddle hizi: kare basina yer degistirme gercek dt ile bolunup suzulur.
  // (Eskiden tek 1/120 adima bolunuyordu: 60Hz'de vurus 2 kat sert cikiyordu.)
  const LEAD_MAX = 0.18, LEAD_SMOOTH = 0.030;         // sn (misafir gecikme telafisi)
  const VEL_TAU_LOCAL = 0.016, VEL_TAU_NET = 0.030;   // sn
  const PADDLE_VMAX = 520;// el hizi ust siniri (touch/ag jitter firlatmasini onler)
  const STALL_SPD = 14;   // bunun altinda "cok yavas" sayilir
  const STALL_TIME = 2.2; // sn: bu kadar sure cok yavas kalirsa hakem yeniden servis
  const TRAP_DIST = 8;    // puck bu yaricapli alandan cikamiyorsa "sikismis"
  const TRAP_TIME = 2.5;  // sn: bu kadar sikisik kalirsa hakem yeniden servis
  const AI_BACKOFF = 0.6; // sn: puck bu kadar sikisik kalirsa AI geri cekilir
  const AI_RECOIL = 0.18; // sn: AI vurustan sonra elini geri ceker (duvara art arda itmesin)
  const STEP = 1 / 120;   // sabit fizik adimi

  // --- Skin'ler (yalnizca gorsel; ag/oyun mantigi etkilenmez) ---
  const SKINS = {
    neon: {
      field: '#0c2a3e', fieldEdge: null,
      line: 'rgba(255,255,255,.18)', lineW: 2,
      rail: null,
      goalTop: '#ff5d73', goalBottom: '#2fd6c4', goalW: 6, crease: false,
      puck: '#ffffff', puckRing: null,
      padLocal: '#2fd6c4', padRemote: '#ff5d73', padRing: null,
      fxTop: '#ff5d73', fxBottom: '#2fd6c4'
    },
    arcade: {                              // klasik BCP arcade masasi
      field: '#1f74e0', fieldEdge: '#0e4aa6',
      line: '#ffffff', lineW: 3,
      rail: '#0b0b0b', railW: 8,
      goalTop: '#e8302a', goalBottom: '#e8302a', goalW: 7, crease: true,
      puck: '#ffd400', puckRing: 'rgba(0,0,0,.35)',
      padLocal: '#2f6dff', padRemote: '#e8302a', padRing: 'rgba(255,255,255,.9)',
      fxTop: '#e8302a', fxBottom: '#ffd400'
    }
  };
  let skinName = 'neon';
  let skin = SKINS.neon;
  function setSkin(n) { skinName = SKINS[n] ? n : 'neon'; skin = SKINS[skinName]; }

  let cv, ctx;
  let role = 'host';      // 'host' | 'guest'
  let mode = 'first7';    // 'first7' | 'first11' | 'timed'
  let cb = {};            // { onHud, onMessage, onGameOver }

  // Tek kisilik mod: AI ust paddle'i (pGuest) kontrol eder, ag yok.
  let ai = false;
  let aiCfg = null;
  let aiErrX = 0, aiErrT = 0;
  let aiRecoil = 0;       // kalan geri cekilme suresi (sn)
  const AI_PRESETS = {
    // spd: paddle hizi (birim/sn), predict: duvar sekmesi tahmini,
    // aggro: ne kadar one cikip vurdugu, home: savunma derinligi, err: nisan hatasi
    easy:   { spd: 62,  predict: false, aggro: 0.35, home: 0.10, err: 7 },
    normal: { spd: 98,  predict: true,  aggro: 0.60, home: 0.12, err: 3.5 },
    hard:   { spd: 145, predict: true,  aggro: 0.88, home: 0.15, err: 1.2 }
  };

  let running = false;
  let rafId = 0;
  let lastT = 0;
  let acc = 0;

  // Yerlesim (CSS px cinsinden letterbox)
  let lay = { scale: 1, offX: 0, offY: 0 };

  // Yetkili durum (host doldurur; misafir state ile gunceller)
  let puck, pHost, pGuest;
  // Fizikteki paddle: hedef konuma kare icindeki adimlara bolunerek gider.
  // { x,y: son adim konumu; tx,ty: onceki karenin hedefi; vx,vy: suzulmus hiz }
  let mHost, mGuest;
  function newMallet(p) { return { x: p.x, y: p.y, tx: p.x, ty: p.y, vx: 0, vy: 0 }; }
  let scoreHost, scoreGuest, phase, winner;
  let countdown = 0, pendingServe = 'random';   // saniye cinsinden kalan sure
  let timeLeft = 120;

  // Misafir: yetkili puck (hiziyla ekstrapole edilir) + rakip paddle hedefi
  let netPuck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  let tgtRemote = { x: W / 2, y: H * 0.18 };
  // Host: misafir paddle'i icin yumusatma hedefi (ag girdisinden)
  let tgtGuest = { x: W / 2, y: H * 0.18 };

  let lastSend = 0;
  let gameOverFired = false;

  // Pointer (tek aktif parmak)
  let activePointer = null;

  // Efektler: fizik olaylarini biriktir, karede ses cal + age ekle
  let pend = { hit: false, wall: false };
  let sendFx = {};
  const fx = { goalLeft: 0, side: null, isMy: false, shake: 0, parts: [] };

  // Puck cok uzun sure cok yavas kalirsa (kimse oynamiyor) hakem reseti
  let slowT = 0, trapT = 0, trapAt = { x: 0, y: 0 };

  function reset(full) {
    puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    pHost = { x: W / 2, y: H * 0.82 };
    pGuest = { x: W / 2, y: H * 0.18 };
    mHost = newMallet(pHost);
    mGuest = newMallet(pGuest);
    if (full) { scoreHost = 0; scoreGuest = 0; }
    winner = null;
    phase = 'countdown';
    pendingServe = 'random';
    countdown = 1.5;
    timeLeft = 120;
    gameOverFired = false;
    netPuck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    tgtRemote = { x: W / 2, y: H * 0.18 };
    tgtGuest = { x: W / 2, y: H * 0.18 };
    pend = { hit: false, wall: false };
    sendFx = {};
    fx.goalLeft = 0; fx.side = null; fx.shake = 0; fx.parts = [];
    resetStall();
    aiRecoil = 0;
    pushHud();
  }

  // --- Koordinat donusumleri ---
  // Host icin masa = gorunum. Misafir icin 180 derece dondurulur.
  function toView(x, y) {
    return role === 'host' ? { x, y } : { x: W - x, y: H - y };
  }
  function fromView(vx, vy) {
    return role === 'host' ? { x: vx, y: vy } : { x: W - vx, y: H - vy };
  }
  function PX(vx) { return lay.offX + vx * lay.scale; }
  function PY(vy) { return lay.offY + vy * lay.scale; }

  function layout() {
    const w = cv.clientWidth, h = cv.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = Math.min(w / W, h / H);
    lay = { scale, offX: (w - W * scale) / 2, offY: (h - H * scale) / 2 };
  }

  // --- Pointer girdisi: yerel paddle ---
  function clampLocalPaddle(p) {
    p.x = Math.max(MR, Math.min(W - MR, p.x));
    if (role === 'host') p.y = Math.max(H / 2, Math.min(H - MR, p.y));
    else p.y = Math.max(MR, Math.min(H / 2, p.y));
  }

  // Kontrol modu (her oyuncunun kendi tercihi, aga gitmez):
  //  'offset' - paddle parmagin USTUNDE durur (parmak paddle'i/puck'i ortmesin).
  //             Ofset kendi kalesine yaklastikca kademeli sifira iner ki
  //             paddle kale agzina kadar inebilsin.
  //  'drag'   - touchpad gibi: paddle parmagin hareketi kadar kayar, parmak
  //             kendi yari sahasinda istedigi yerde durabilir (isinlanma yok).
  let ctrl = 'offset';
  const FINGER_CLEAR = 30;    // paddle alt kenari ile parmak temas noktasi arasi (CSS px)
  function offsetPx() { return MR * lay.scale + FINGER_CLEAR; }   // parmak -> paddle merkezi
  const OFFSET_TAPER = 0.2;   // kendi kale cizgisinden H*0.2 icinde ofset 0'a iner
  const DRAG_GAIN = 1.25;     // kaydirmada parmak hareketi carpani
  let dragLast = null;
  function setControl(m) { ctrl = m === 'drag' ? 'drag' : 'offset'; }

  // Pointer -> gorunum koordinati (kendi kalesi altta, y=H). Kirpilmaz.
  function pointerToView(ev) {
    const r = cv.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left - lay.offX) / lay.scale,
      y: (ev.clientY - r.top - lay.offY) / lay.scale
    };
  }

  function onPointerDown(ev) {
    if (activePointer !== null) return;
    activePointer = ev.pointerId;
    try { cv.setPointerCapture && cv.setPointerCapture(ev.pointerId); } catch (e) {}
    dragLast = pointerToView(ev);
    if (ctrl === 'drag') { ev.preventDefault(); return; }   // dokununca isinlanma yok
    movePaddle(ev);
  }
  function onPointerMove(ev) {
    if (ev.pointerId !== activePointer) return;
    movePaddle(ev);
  }
  function onPointerUp(ev) {
    if (ev.pointerId === activePointer) { activePointer = null; dragLast = null; }
  }
  function movePaddle(ev) {
    ev.preventDefault();
    const p = pointerToView(ev);
    const local = role === 'host' ? pHost : pGuest;
    let vx, vy;
    if (ctrl === 'drag') {
      const cur = toView(local.x, local.y);
      const last = dragLast || p;
      vx = cur.x + (p.x - last.x) * DRAG_GAIN;
      vy = cur.y + (p.y - last.y) * DRAG_GAIN;
      dragLast = p;
    } else {
      vx = Math.max(0, Math.min(W, p.x));
      const fy = Math.max(0, Math.min(H, p.y));
      const k = Math.max(0, Math.min(1, (H - fy) / (H * OFFSET_TAPER)));
      vy = fy - (offsetPx() / lay.scale) * k;
    }
    const t = fromView(vx, vy);
    local.x = t.x; local.y = t.y;
    clampLocalPaddle(local);
  }

  // --- Yapay zeka (ust paddle = pGuest, ust kaleyi y=0 savunur) ---
  function aiMove() {
    const cfg = aiCfg;
    const homeY = H * cfg.home;
    const now = performance.now();
    // Nisan hatasini yavasca degistir (her karede titremesin)
    if (now - aiErrT > 280) { aiErrT = now; aiErrX = (Math.random() * 2 - 1) * cfg.err; }

    let tx = W / 2, ty = homeY;

    // Puck sikismis gorunuyorsa (or. AI onu koseye bastiriyor) kaleye cekil:
    // puck kendi sekmesiyle kurtulsun; kurtulmazsa TRAP_TIME'da hakem servisi.
    const atWall = puck.x < PR + MR || puck.x > W - PR - MR || puck.y < PR + MR;
    if (aiRecoil > 0) aiRecoil -= STEP;
    if (phase === 'play' && (aiRecoil > 0 || (atWall && trapT > AI_BACKOFF))) {
      tx = W / 2; ty = homeY;
    } else if (phase === 'play') {
      const onAiHalf = puck.y < H / 2;
      const towardAiGoal = puck.vy < -5;            // puck AI kalesine dogru
      const chaseLine = (H / 2) * (0.55 + 0.45 * cfg.aggro);

      if (onAiHalf && !towardAiGoal && puck.y < chaseLine) {
        // Hucum: puck'in arkasina gec, fizik onu oyuncuya dogru itsin
        tx = puck.x;
        ty = Math.min(H / 2 - MR, Math.max(MR, puck.y - (PR + MR) * 0.5));
      } else if (towardAiGoal) {
        // Savunma: puck'in paddle hizasina gelecegi x'i tahmin et
        let t = (homeY - puck.y) / puck.vy;          // vy<0, homeY<puck.y -> t>0
        if (!isFinite(t) || t < 0) t = 0;
        let px = puck.x + puck.vx * t;
        if (cfg.predict) {
          const span = W - 2 * PR;                   // duvar sekmesini katla
          let m = ((px - PR) % (2 * span) + 2 * span) % (2 * span);
          px = PR + (m <= span ? m : 2 * span - m);
        } else {
          px = puck.x;                               // basit takip
        }
        tx = px;
        ty = homeY;
      }
    }

    tx += aiErrX;
    tx = Math.max(MR, Math.min(W - MR, tx));
    ty = Math.max(MR, Math.min(H / 2, ty));

    // Hiz sinirli hareket
    const maxStep = cfg.spd * STEP;
    let dx = tx - pGuest.x, dy = ty - pGuest.y;
    const dist = Math.hypot(dx, dy);
    if (dist > maxStep) { dx = dx / dist * maxStep; dy = dy / dist * maxStep; }
    pGuest.x += dx;
    pGuest.y += dy;
  }

  // --- Fizik (yalnizca host) ---
  // Kare basi: paddle hizini gercek kare suresiyle olc ve suz
  function trackMallet(m, p, dt, tau) {
    if (dt <= 0) return;
    const a = 1 - Math.exp(-dt / tau);
    m.vx += ((p.x - m.tx) / dt - m.vx) * a;
    m.vy += ((p.y - m.ty) / dt - m.vy) * a;
    m.tx = p.x; m.ty = p.y;
  }
  // Adim: kalan yolun 1/left kadarini git; eski konumu dondur (supurme icin)
  function stepMallet(m, p, left) {
    const q0 = { x: m.x, y: m.y };
    m.x += (p.x - m.x) / left;
    m.y += (p.y - m.y) / left;
    return q0;
  }
  function softCap(v) {
    const cap = spdCap();
    return v <= SPD_KNEE ? v : SPD_KNEE + (cap - SPD_KNEE) * (1 - Math.exp(-(v - SPD_KNEE) / (cap - SPD_KNEE)));
  }

  // left: bu karede (bu dahil) kalan adim sayisi
  function integrate(left) {
    const hq0 = stepMallet(mHost, pHost, left);
    const hv = { x: mHost.vx, y: mHost.vy };
    let gq0, gv;
    if (ai) {                                 // AI adim adim ilerler: hiz kesin
      gq0 = { x: pGuest.x, y: pGuest.y };
      aiMove();
      mGuest.x = pGuest.x; mGuest.y = pGuest.y;
      gv = { x: (mGuest.x - gq0.x) / STEP, y: (mGuest.y - gq0.y) / STEP };
    } else {
      gq0 = stepMallet(mGuest, pGuest, left);
      gv = { x: mGuest.vx, y: mGuest.vy };
    }

    if (phase !== 'play') return;

    const px0 = puck.x, py0 = puck.y;       // adim oncesi puck konumu
    puck.x += puck.vx * STEP;
    puck.y += puck.vy * STEP;
    drag(puck, STEP);

    collide(mHost, hv, hq0, px0, py0);
    if (collide(mGuest, gv, gq0, px0, py0) && ai) aiRecoil = AI_RECOIL;

    // yatay duvarlar
    if (puck.x - PR < 0) { puck.x = PR; puck.vx = Math.abs(puck.vx) * WALL_E; pend.wall = true; }
    if (puck.x + PR > W) { puck.x = W - PR; puck.vx = -Math.abs(puck.vx) * WALL_E; pend.wall = true; }

    const inGoal = Math.abs(puck.x - W / 2) < GOAL_W / 2;
    // ust (y=0): misafirin kalesi -> host sayi yapar
    if (puck.y - PR < 0) {
      if (inGoal) {
        if (puck.y < -PR * 2) return score('host');
        if (puck.vy > -40) puck.vy = -40;     // kale agzinda takilmasin, file ici
      } else { puck.y = PR; puck.vy = Math.abs(puck.vy) * WALL_E; pend.wall = true; }
    }
    // alt (y=H): host'un kalesi -> misafir sayi yapar
    if (puck.y + PR > H) {
      if (inGoal) {
        if (puck.y > H + PR * 2) return score('guest');
        if (puck.vy < 40) puck.vy = 40;       // kale agzinda takilmasin, file ici
      } else { puck.y = H - PR; puck.vy = -Math.abs(puck.vy) * WALL_E; pend.wall = true; }
    }

    const sp = Math.hypot(puck.vx, puck.vy);   // taban yok, puck dogal yavaslar

    // Takilma (sabit adim sayaci; mutlak saat yok):
    //  1) cok uzun sure cok yavas (kimse oynamiyor)
    //  2) SIKISMA: puck hizli sekse de kucuk bir alandan cikamiyor (or. paddle
    //     onu koseye bastiriyor -> ses gelir ama oyun ilerlemez). Hiz bakmaz.
    if (sp < STALL_SPD) slowT += STEP; else slowT = 0;
    if (Math.hypot(puck.x - trapAt.x, puck.y - trapAt.y) > TRAP_DIST) {
      trapAt = { x: puck.x, y: puck.y };
      trapT = 0;
    } else {
      trapT += STEP;
    }
    if (slowT > STALL_TIME || trapT > TRAP_TIME) faceoff();
  }

  // Surtunme (host fizigi + misafir ekstrapolasyonu ortak kullanir)
  function drag(p, dt) {
    const v = Math.hypot(p.vx, p.vy);
    if (v < 1e-6) return;
    const k = Math.max(0, v - (DRAG_C + DRAG_1 * v + DRAG_2 * v * v) * dt) / v;
    p.vx *= k; p.vy *= k;
  }

  // Paddle'siz serbest hareket tahmini (misafir): duvar sekmesi + surtunme
  function coast(p, dt) {
    for (let n = Math.ceil(dt / STEP - 1e-6); n > 0; n--) {
      const h = Math.min(STEP, dt); dt -= h;
      p.x += p.vx * h; p.y += p.vy * h;
      drag(p, h);
      if (p.x < PR) { p.x = PR; p.vx = Math.abs(p.vx) * WALL_E; }
      if (p.x > W - PR) { p.x = W - PR; p.vx = -Math.abs(p.vx) * WALL_E; }
      if (Math.abs(p.x - W / 2) >= GOAL_W / 2) {
        if (p.y < PR) { p.y = PR; p.vy = Math.abs(p.vy) * WALL_E; }
        if (p.y > H - PR) { p.y = H - PR; p.vy = -Math.abs(p.vy) * WALL_E; }
      }
    }
    p.y = Math.max(-PR, Math.min(H + PR, p.y));
  }
  // Misafir gecikme telafisi: puck KENDI yarisindayken (rakip dokunamaz ->
  // tahmin guvenli) gidis-donus + cizim yumusatmasi kadar ileri goster ki
  // savurma host'a vardiginda puck orada olsun. Rakip yarisinda telafi yok.
  function leadTime(p) {
    const rtt = Math.min(LEAD_MAX, (Net.rtt ? Net.rtt() : 0) / 1000);
    const k = Math.max(0, Math.min(1, (H * 0.60 - p.y) / (H * 0.20)));
    return (rtt + LEAD_SMOOTH) * k;
  }

  // Hakem: puck'i merkeze koyup rastgele yone yumusak servis (gol degil)
  function faceoff() {
    const ang = Math.random() * Math.PI * 2;
    puck = { x: W / 2, y: H / 2, vx: Math.cos(ang) * 85, vy: Math.sin(ang) * 85 };
    resetStall();
  }
  function resetStall() {
    slowT = 0; trapT = 0;
    trapAt = { x: puck.x, y: puck.y };
  }

  // Puck-mallet carpismasi: mallet el kontrollu = sonsuz kutle.
  // Bagil normal hizi restitution ile yansitilir; momentum aktarimi
  // (paddle'in puck'i itmesi/vurmasi) bu modelden dogal olarak cikar.
  // Puck surtunmesiz oldugu icin tegetsel bilesen degismez (gercekci).
  // SUPURMELI carpisma: puck (p0->p1) ve paddle (q0->q1) bu adim boyunca
  // bagil olarak hareket eder; yollari minD'ye girerse vurus sayilir.
  // Boylece hizli kaydirmada paddle topun "icinden gecmez", isabet eder.
  function collide(q1, pv, q0, px0, py0) {
    const minD = PR + MR;
    const ax = px0 - q0.x, ay = py0 - q0.y;          // bagil konum, t=0
    const bx = puck.x - q1.x, by = puck.y - q1.y;    // bagil konum, t=1
    const dx = bx - ax, dy = by - ay;
    const A = dx * dx + dy * dy;
    let t;
    if (A < 1e-9) {                                  // bagil hareket yok
      if (ax * ax + ay * ay >= minD * minD) return;
      t = 0;
    } else {
      const C = ax * ax + ay * ay - minD * minD;
      if (C <= 0) {
        // Zaten ic ice: adim SONUNDA ayrilmislarsa karisma. (Eskiden burada
        // puck'in kendi hareketi silinip paddle'in onune konuyordu -> vurulan
        // puck paddle durana kadar yapisip surukleniyordu.)
        if (bx * bx + by * by >= minD * minD) return;
        t = 1;
      } else {
        const B = 2 * (ax * dx + ay * dy);
        const disc = B * B - 4 * A * C;
        if (disc < 0) return;                        // hic temas etmiyor
        t = (-B - Math.sqrt(disc)) / (2 * A);        // giris ani
        if (t < 0 || t > 1) return;                  // bu adim icinde degil
      }
    }
    // Temas anindaki konumlar
    const qcx = q0.x + (q1.x - q0.x) * t;
    const qcy = q0.y + (q1.y - q0.y) * t;
    const pcx = px0 + (puck.x - px0) * t;
    const pcy = py0 + (puck.y - py0) * t;
    let nx = pcx - qcx, ny = pcy - qcy;
    let nl = Math.hypot(nx, ny);
    if (nl < 1e-4) { nx = 0; ny = role === 'host' ? -1 : 1; nl = 1; }
    nx /= nl; ny /= nl;
    // Puck'i temas yuzeyinin biraz disina koy (tam minD'de kalip her
    // karede yeniden tetiklenmesin)
    puck.x = qcx + nx * (minD + 0.1);
    puck.y = qcy + ny * (minD + 0.1);
    // El hizini makul sinirla (touch/ag jitter'i firlatma yapmasin)
    let pvx = pv.x, pvy = pv.y;
    const ps = Math.hypot(pvx, pvy);
    if (ps > PADDLE_VMAX) { pvx *= PADDLE_VMAX / ps; pvy *= PADDLE_VMAX / ps; }
    // Restitution'lu impuls (sonsuz kutleli mallet) - yalniz yaklasiyorsa
    const vn = (puck.vx - pvx) * nx + (puck.vy - pvy) * ny;
    let realHit = false;
    if (vn < 0) {
      const j = -(1 + PADDLE_E) * vn;
      puck.vx += j * nx;
      puck.vy += j * ny;
      realHit = true;
    }
    // Yapisma onleyici: puck DAIMA paddle'dan ayrilsin. Yoksa yavas puck
    // duran paddle'a yapisip her kare yeniden carpisir (takilma + ses spam).
    const outN = puck.vx * nx + puck.vy * ny;
    const MIN_OUT = 30;
    if (outN < MIN_OUT) {
      const add = MIN_OUT - outN;
      puck.vx += add * nx;
      puck.vy += add * ny;
    }
    // Adimin kalaninda puck YENI hiziyla gitsin (paddle da q1'e ilerliyor);
    // yoksa adim sonunda yine ic ice kalir.
    const sp = Math.hypot(puck.vx, puck.vy);
    if (realHit && sp > SPD_KNEE) { const k = softCap(sp) / sp; puck.vx *= k; puck.vy *= k; }
    puck.x += puck.vx * STEP * (1 - t);
    puck.y += puck.vy * STEP * (1 - t);
    // El puck tavanindan hizliysa yine cakisir: temas NORMALI yonunde disari
    // koy (q1->puck yonu degil: hizli kaydirmada paddle puck'i gecip puck
    // arkaya dusmesin).
    if (Math.hypot(puck.x - q1.x, puck.y - q1.y) < minD) {
      puck.x = q1.x + nx * (minD + 0.1);
      puck.y = q1.y + ny * (minD + 0.1);
    }
    // Ses/efekt yalniz gercek vurusta (yaklasirken) - yaslanmada degil
    if (realHit) pend.hit = true;
    return realHit;
  }

  // Gol gorsel + ses efekti (host/AI: score()'da; misafir: handleState'de)
  function goalFx(side) {
    const isMy = (side === 'host' && role === 'host') ||
                 (side === 'guest' && role === 'guest');
    const gy = side === 'host' ? 0 : H;          // host sayisi -> ust kale (y=0)
    const dirY = side === 'host' ? 1 : -1;
    fx.side = side;
    fx.isMy = isMy;
    fx.goalLeft = 1.2;
    fx.shake = 9;
    fx.parts = [];
    for (let i = 0; i < 22; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 35 + Math.random() * 85;
      fx.parts.push({
        x: W / 2 + (Math.random() * 2 - 1) * GOAL_W / 2,
        y: gy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp + dirY * 55,
        life: 0.75 + Math.random() * 0.4
      });
    }
    if (typeof Sfx !== 'undefined') Sfx.goal(isMy);
  }

  function score(side) {
    if (side === 'host') scoreHost++; else scoreGuest++;
    pushHud();
    goalFx(side);
    sendFx.g = side;
    if (mode !== 'timed') {
      const target = mode === 'first11' ? 11 : 7;
      if (scoreHost >= target || scoreGuest >= target) return endGame();
    }
    puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    pendingServe = side === 'host' ? 'toGuest' : 'toHost';
    phase = 'countdown';
    countdown = 1.2;
  }

  function endGame() {
    phase = 'over';
    winner = scoreHost > scoreGuest ? 'host'
           : scoreGuest > scoreHost ? 'guest' : 'draw';
    fireGameOver();
  }

  function serve() {
    phase = 'play';
    let dirY = pendingServe === 'toHost' ? 1
             : pendingServe === 'toGuest' ? -1
             : (Math.random() < 0.5 ? 1 : -1);
    puck.vx = (Math.random() * 2 - 1) * 45;
    puck.vy = dirY * 75;
  }

  // --- HUD / mesaj / bitis (perspektif: herkes alt kaleyi savunur) ---
  function pushHud() {
    const myScore = role === 'host' ? scoreHost : scoreGuest;
    const opScore = role === 'host' ? scoreGuest : scoreHost;
    let timerTxt = null;
    if (mode === 'timed') {
      const s = Math.max(0, Math.ceil(timeLeft));
      timerTxt = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }
    cb.onHud && cb.onHud(opScore, myScore, timerTxt);
  }

  function fireGameOver() {
    if (gameOverFired) return;
    gameOverFired = true;
    let res = 'draw';
    if (winner === 'host') res = role === 'host' ? 'win' : 'lose';
    else if (winner === 'guest') res = role === 'guest' ? 'win' : 'lose';
    const myScore = role === 'host' ? scoreHost : scoreGuest;
    const opScore = role === 'host' ? scoreGuest : scoreHost;
    cb.onGameOver && cb.onGameOver(res, myScore + ' - ' + opScore);
  }

  // --- Ag ---
  function maybeSend(now) {
    if (ai) return;                 // tek kisilik mod: ag yok
    if (now - lastSend < 16) return; // ~60Hz (eskiden 30Hz -> daha az gecikme)
    lastSend = now;
    if (role === 'host') {
      let f = null;
      if (sendFx.h || sendFx.w || sendFx.g) { f = sendFx; sendFx = {}; }
      Net.sendState({
        p: { x: puck.x, y: puck.y, vx: puck.vx, vy: puck.vy },
        h: { x: pHost.x, y: pHost.y },
        sh: scoreHost, sg: scoreGuest,
        ph: phase, t: timeLeft, w: winner,
        pr: PR, fx: f
      });
    } else {
      Net.sendInput({ x: pGuest.x, y: pGuest.y });
    }
  }

  // Host: misafir paddle girdisi -> hedef (her karede yumusatilir)
  function handleInput(d) {
    if (ai || role !== 'host' || !d) return;
    tgtGuest.x = Math.max(MR, Math.min(W - MR, d.x));
    tgtGuest.y = Math.max(MR, Math.min(H / 2, d.y));
  }

  // Misafir: host'un yetkili durumu (puck hiziyla ekstrapole edilir)
  function handleState(d) {
    if (role !== 'guest' || !d) return;
    netPuck = { x: d.p.x, y: d.p.y, vx: d.p.vx, vy: d.p.vy };
    if (d.pr) PR = d.pr;          // puck boyutu host tarafindan belirlenir
    if (d.ph === 'play') coast(netPuck, leadTime(netPuck));
    tgtRemote = { x: d.h.x, y: d.h.y };
    scoreHost = d.sh; scoreGuest = d.sg;
    phase = d.ph; timeLeft = d.t; winner = d.w;
    pushHud();
    if (d.fx) {
      if (typeof Sfx !== 'undefined') {
        if (d.fx.h) Sfx.hit();
        if (d.fx.w) Sfx.wall();
      }      if (d.fx.g) goalFx(d.fx.g);
    }
    if (phase === 'over') fireGameOver();
  }

  // --- Dongu ---
  // Tum zamanlama dt birikimine baglidir (mutlak saat karsilastirmasi YOK):
  // rAF zaman damgasi ile performance.now() farkli orijinli olabilir, bu da
  // gol sonrasi servis'in hic tetiklenmeyip oyunu dondurmasina yol acardi.
  function frame(now) {
    if (!running) return;
    try {
      // negatif/ileri sicrama korumali dt
      const dt = Math.max(0, Math.min(0.05, (now - lastT) / 1000));
      lastT = now;

      if (role === 'host') {
        // Misafir paddle'i: yetkili konum = en son bildirilen (gecikme
        // EKLEMEDEN). Hizli kaydirmada da degmesi supurmeli collide ile
        // saglanir (paddle'in eski->yeni yolu puck'i kesiyorsa vurur).
        if (!ai) { pGuest.x = tgtGuest.x; pGuest.y = tgtGuest.y; }
        // sayac
        if (mode === 'timed' && phase !== 'over') {
          timeLeft -= dt;
          pushHud();
          if (timeLeft <= 0) { timeLeft = 0; endGame(); }
        }
        // geri sayim: dt ile azalt, bitince servis
        if (phase === 'countdown') {
          countdown -= dt;
          if (countdown <= 0) serve();
        }
        // sabit adimli fizik
        acc += dt;
        trackMallet(mHost, pHost, dt, VEL_TAU_LOCAL);
        if (!ai) trackMallet(mGuest, pGuest, dt, VEL_TAU_NET);
        let left = Math.min(6, Math.floor(acc / STEP));
        for (; left > 0; left--) { integrate(left); acc -= STEP; }
        if (acc > STEP * 6) acc = 0;
        // bu karenin fizik olaylarini sesle + age yansit
        if (pend.hit) { if (typeof Sfx !== 'undefined') Sfx.hit(); sendFx.h = true; pend.hit = false; }
        if (pend.wall) { if (typeof Sfx !== 'undefined') Sfx.wall(); sendFx.w = true; pend.wall = false; }
      } else {
        // Misafir: yetkili puck'i HIZIYLA ekstrapole et (dead-reckoning) ->
        // 30/60Hz guncellemeler arasinda puck gercek zamanli akar, gecikme
        // hissi cok azalir. Sonra cizilen puck'i ona hizla yaklastir.
        // Duvarda sekme + surtunme de tahmin edilir (host ile ayni kurallar).
        coast(netPuck, dt);
        const ap = Math.min(1, dt * 30);
        puck.x += (netPuck.x - puck.x) * ap;
        puck.y += (netPuck.y - puck.y) * ap;
        // Rakip (host) paddle: hiz yok -> hedefe snappy yumusatma
        const ak = Math.min(1, dt * 22);
        pHost.x += (tgtRemote.x - pHost.x) * ak;
        pHost.y += (tgtRemote.y - pHost.y) * ak;
      }

      maybeSend(now);
      render(now, dt);
    } catch (e) {
      // Bir hata olsa bile dongu olmesin (kalici donma engeli)
      console.error('[airhockey] kare hatasi:', e);
    }
    rafId = requestAnimationFrame(frame);
  }

  // --- Cizim ---
  function render(now, dt) {
    const w = cv.clientWidth, h = cv.clientHeight;
    ctx.clearRect(-20, -20, w + 40, h + 40);

    // Gol aninda ekran sarsintisi
    let sx = 0, sy = 0;
    if (fx.shake > 0) {
      sx = (Math.random() * 2 - 1) * fx.shake;
      sy = (Math.random() * 2 - 1) * fx.shake;
      fx.shake = Math.max(0, fx.shake - dt * 28);
    }
    ctx.save();
    ctx.translate(sx, sy);

    // masa zemini
    const a = toView(0, 0), b = toView(W, H);
    const x0 = PX(Math.min(a.x, b.x)), y0 = PY(Math.min(a.y, b.y));
    const tw = W * lay.scale, th = H * lay.scale;
    let grd = null;
    if (skin.fieldEdge && ctx.createLinearGradient) {
      grd = ctx.createLinearGradient(0, y0, 0, y0 + th);
      grd.addColorStop(0, skin.field);
      grd.addColorStop(1, skin.fieldEdge);
    }
    ctx.fillStyle = grd || skin.field;
    ctx.fillRect(x0, y0, tw, th);
    if (skin.rail) { ctx.strokeStyle = skin.rail; ctx.lineWidth = skin.railW; }
    else { ctx.strokeStyle = skin.line; ctx.lineWidth = skin.lineW; }
    ctx.strokeRect(x0, y0, tw, th);

    // orta cizgi + daire + nokta
    ctx.strokeStyle = skin.line;
    ctx.lineWidth = skin.lineW;
    const m1 = toView(0, H / 2), m2 = toView(W, H / 2);
    ctx.beginPath();
    ctx.moveTo(PX(m1.x), PY(m1.y));
    ctx.lineTo(PX(m2.x), PY(m2.y));
    ctx.stroke();
    const c = toView(W / 2, H / 2);
    ctx.beginPath();
    ctx.arc(PX(c.x), PY(c.y), 16 * lay.scale, 0, Math.PI * 2);
    ctx.stroke();
    circle(PX(c.x), PY(c.y), 2.4 * lay.scale, skin.line);

    // kaleler
    drawGoal(0, skin.goalTop);
    drawGoal(H, skin.goalBottom);

    // disk
    const pv = toView(puck.x, puck.y);
    const ppx = PX(pv.x), ppy = PY(pv.y);
    circle(ppx, ppy, PR * lay.scale, skin.puck);
    if (skin.puckRing) {
      ctx.beginPath();
      ctx.arc(ppx, ppy, PR * lay.scale, 0, Math.PI * 2);
      ctx.strokeStyle = skin.puckRing; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // paddle'lar (kendi vs rakip)
    const localP = role === 'host' ? pHost : pGuest;
    const remoteP = role === 'host' ? pGuest : pHost;
    const lv = toView(localP.x, localP.y);
    const rv = toView(remoteP.x, remoteP.y);
    drawPaddle(PX(rv.x), PY(rv.y), skin.padRemote);
    drawPaddle(PX(lv.x), PY(lv.y), skin.padLocal);

    // --- Gol efektleri --- (dt tabanli sayac, mutlak saat yok)
    if (fx.goalLeft > 0) fx.goalLeft = Math.max(0, fx.goalLeft - dt);
    const goalActive = fx.goalLeft > 0;
    if (goalActive || fx.parts.length) {
      const col = fx.side === 'host' ? skin.fxTop : skin.fxBottom;
      const gc = toView(W / 2, fx.side === 'host' ? 0 : H);
      const gx = PX(gc.x), gy = PY(gc.y);

      if (goalActive) {
        const rem = fx.goalLeft / 1.2;                  // 1 -> 0
        const prog = 1 - rem;                           // 0 -> 1
        // hafif renkli parlama (masa icinde)
        ctx.save();
        ctx.globalAlpha = rem * 0.28;
        ctx.fillStyle = col;
        ctx.fillRect(x0, y0, tw, th);
        ctx.restore();
        // genisleyen halka
        ctx.save();
        ctx.globalAlpha = Math.max(0, rem);
        ctx.strokeStyle = col;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(gx, gy, prog * W * 0.85 * lay.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // parcaciklar
      for (let i = fx.parts.length - 1; i >= 0; i--) {
        const p = fx.parts[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy *= (1 - dt * 0.6);
        p.life -= dt;
        if (p.life <= 0) { fx.parts.splice(i, 1); continue; }
        const vpos = toView(p.x, p.y);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        circle(PX(vpos.x), PY(vpos.y), 1.9 * lay.scale, col);
        ctx.restore();
      }
    }

    ctx.restore();   // sarsinti

    // orta mesaj
    let msg = '', isGoal = false;
    if (goalActive && fx.goalLeft > 0.4) {
      msg = fx.isMy ? 'GOL! 🎉' : 'Gol yedin';
      isGoal = true;
    } else if (phase === 'countdown') {
      if (role === 'host') {
        const left = Math.max(0, Math.ceil(countdown));
        msg = left > 0 ? String(left) : '';
      } else {
        msg = 'Hazır ol...';
      }
    }
    cb.onMessage && cb.onMessage(msg, isGoal);
  }

  function drawGoal(yEdge, color) {
    // kale agzi cizgisi
    const g1 = toView(W / 2 - GOAL_W / 2, yEdge);
    const g2 = toView(W / 2 + GOAL_W / 2, yEdge);
    ctx.strokeStyle = color;
    ctx.lineWidth = skin.goalW;
    ctx.beginPath();
    ctx.moveTo(PX(g1.x), PY(g1.y));
    ctx.lineTo(PX(g2.x), PY(g2.y));
    ctx.stroke();
    // kale yayi (crease) - tablo uzayinda polyline -> host/guest dogru doner
    if (skin.crease) {
      const R = GOAL_W * 0.62, N = 18;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const t = Math.PI * i / N;
        const tx = W / 2 + R * Math.cos(t);
        const ty = yEdge === 0 ? R * Math.sin(t) : H - R * Math.sin(t);
        const v = toView(tx, ty);
        const px = PX(v.x), py = PY(v.y);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineWidth = Math.max(2, skin.goalW - 2);
      ctx.stroke();
    }
  }
  // Rengi ac/koyult: amt>0 acar, amt<0 koyultur (-1..1)
  function shade(hex, amt) {
    if (typeof hex !== 'string' || hex[0] !== '#' || hex.length < 7) return hex;
    const ch = (i) => parseInt(hex.slice(i, i + 2), 16);
    const f = (c) => {
      const v = amt >= 0 ? c + (255 - c) * amt : c * (1 + amt);
      return Math.max(0, Math.min(255, Math.round(v)));
    };
    return 'rgb(' + f(ch(1)) + ',' + f(ch(3)) + ',' + f(ch(5)) + ')';
  }
  function ring(x, y, r, color, lw) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
  }

  // Gercek air hockey pusher gorunumu (ustten bakis):
  // koyu taban flansi + kubbe govde + ortada tutamak kabi + parlama
  function drawPaddle(x, y, color) {
    const R = MR * lay.scale;

    // 1) taban flansi (en dis, koyu kenar) + ince kontur
    circle(x, y, R, shade(color, -0.38));
    ring(x, y, R, 'rgba(0,0,0,.35)', Math.max(1, R * 0.06));

    // 2) kubbe govde - radyal gradient ile 3B his
    const bodyR = R * 0.80;
    if (ctx.createRadialGradient) {
      const g = ctx.createRadialGradient(
        x - bodyR * 0.32, y - bodyR * 0.32, bodyR * 0.1, x, y, bodyR);
      g.addColorStop(0, shade(color, 0.38));
      g.addColorStop(0.55, color);
      g.addColorStop(1, shade(color, -0.22));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = color;
    }
    ctx.beginPath(); ctx.arc(x, y, bodyR, 0, Math.PI * 2); ctx.fill();

    // 3) tutamak kabi (orta knob)
    const knobR = R * 0.34;
    if (ctx.createRadialGradient) {
      const g2 = ctx.createRadialGradient(
        x - knobR * 0.35, y - knobR * 0.35, knobR * 0.1, x, y, knobR);
      g2.addColorStop(0, shade(color, 0.55));
      g2.addColorStop(1, shade(color, -0.12));
      ctx.fillStyle = g2;
    } else {
      ctx.fillStyle = shade(color, 0.2);
    }
    ctx.beginPath(); ctx.arc(x, y, knobR, 0, Math.PI * 2); ctx.fill();
    ring(x, y, knobR, 'rgba(0,0,0,.28)', Math.max(1, R * 0.045));

    // 4) parlak nokta (specular)
    ctx.beginPath();
    ctx.arc(x - knobR * 0.3, y - knobR * 0.35, knobR * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fill();

    // skin opsiyonel dis halka ( or. mavi zeminde gorunurluk)
    if (skin.padRing) ring(x, y, R, skin.padRing, 2);
  }
  function circle(x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // --- Genel API ---
  function init(canvas, callbacks) {
    cv = canvas;
    ctx = cv.getContext('2d');
    cb = callbacks || {};

    cv.addEventListener('pointerdown', onPointerDown);
    cv.addEventListener('pointermove', onPointerMove);
    cv.addEventListener('pointerup', onPointerUp);
    cv.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', layout);

    Net.on('input', handleInput);
    Net.on('state', handleState);
  }

  function start(opts) {
    role = opts.role;
    mode = opts.rules || 'first7';
    ai = !!opts.ai;
    aiCfg = AI_PRESETS[opts.difficulty] || AI_PRESETS.normal;
    aiErrX = 0; aiErrT = 0;
    reset(true);
    layout();
    running = true;
    lastT = performance.now();
    acc = 0;
    rafId = requestAnimationFrame(frame);
  }

  function restart() {
    reset(true);
    lastT = performance.now();
    acc = 0;
    if (!running) {
      running = true;
      rafId = requestAnimationFrame(frame);
    }
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  // Duraklatilan (stop) maci kaldigi yerden surdur. Duraklamada parmak
  // oynamis olabilir: paddle hizini sifirla (devamda sahte sert vurus olmasin).
  function resume() {
    if (running) return;
    mHost = newMallet(pHost);
    mGuest = newMallet(pGuest);
    lastT = performance.now();
    acc = 0;
    running = true;
    rafId = requestAnimationFrame(frame);
  }

  // Test/hata ayiklama icin salt-okunur durum
  function _peek() { return { role, ctrl, phase, lay: { ...lay }, puck: { ...puck }, pHost: { ...pHost }, pGuest: { ...pGuest }, MR, PR, trapT }; }
  // Yalniz test: puck'i belirli bir duruma koy (or. kose sikismasi senaryosu)
  function _setPuck(x, y, vx, vy) { puck = { x, y, vx, vy }; phase = 'play'; countdown = 0; }

  return { init, start, restart, stop, resume, layout, setSkin, setPuckSize, setControl, handleInput, handleState, _peek, _setPuck };
})();
