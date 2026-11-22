// Akis kontrolu: lobi -> davet -> oyun -> bitis, ayarlar, duraklatma ve ag olaylari.

(() => {
  // role: null = mac/oda yok. ai: tek kisilik mi.
  const session = { role: null, password: '', rules: 'first7', ai: false, difficulty: 'normal', skin: 'neon', puck: 'med' };
  const RULE_TXT = { first7: 'ilk 7', first11: 'ilk 11', timed: '2 dakika' };
  const DIFF_TXT = { easy: 'Kolay', normal: 'Orta', hard: 'Zor' };
  const PUCK_TXT = { small: 'küçük puck', med: 'orta puck', large: 'büyük puck' };
  const KMH = 0.0122 * 3.6;          // 1 birim = 1.22 cm (masa eni 122 cm) -> km/sa

  function load(key, dflt) { try { return localStorage.getItem(key) || dflt; } catch (e) { return dflt; } }
  function save(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }
  const online = () => !!session.role && !session.ai;

  // --- Seri skoru + rovans hazirligi ---
  let series = { me: 0, op: 0 };
  let ready = { me: false, op: false };
  function resetSeries() { series = { me: 0, op: 0 }; }
  function resetReady() { ready = { me: false, op: false }; UI.ready(online(), false, false); }

  Game.init(UI.$('board'), {
    onHud: UI.hud,
    onMessage: UI.message,
    onGameOver: (result, o) => {
      if (result === 'lose') Sfx.lose(); else Sfx.win();
      if (result === 'win') series.me++;
      else if (result === 'lose') series.op++;
      const st = o.stats && { time: o.stats.time, top: Math.round(o.stats.top * KMH), hitsMe: o.stats.hitsMe, hitsOp: o.stats.hitsOp };
      UI.endScreen(result, { me: o.me, op: o.op, series, stats: st });
      UI.ready(online(), ready.me, ready.op);
    }
  });

  function enterGame(opts) {
    resetReady();
    UI.resetScores();
    UI.show('game');
    Game.stop();                     // onceki dongu kalmissa cift calismasin
    Game.start(opts);
  }
  function startAi() {
    session.ai = true;
    session.role = 'host';
    Game.setSkin(session.skin);      // online'da kuranin ayari kalmis olabilir
    Game.setPuckSize(session.puck);
    document.body.classList.toggle('skin-arcade', session.skin === 'arcade');
    enterGame({ role: 'host', rules: session.rules, ai: true, difficulty: session.difficulty });
  }
  function goHome(msg) {
    Game.stop();
    UI.netMsg(''); stopDropTimer();
    session.role = null; session.ai = false;
    resetSeries();
    applySkin(session.skin); applyPuck(session.puck);
    UI.show('lobby');
    UI.lobbyMode('home');
    if (msg) UI.lobbyError(msg);
  }

  // iOS: ses, jest icinde acilmali. pointerdown bazi iOS surumlerinde
  // yetmez; touchend/click daha guvenilir -> hepsine bagla (idempotent).
  ['pointerdown', 'touchend', 'click'].forEach((ev) =>
    document.addEventListener(ev, () => Sfx.unlock(), { passive: true }));

  // --- Ayarlar (hepsi hatirlanir) ---
  function applySound(on) {
    save('ah_sound', on ? 'on' : 'off');
    Sfx.setMuted(!on);
    UI.markSound(on);
  }
  function applyPuck(size) {
    const s = (size === 'small' || size === 'large') ? size : 'med';
    save('ah_puck', s);
    session.puck = s;
    Game.setPuckSize(s);
    UI.markPuck(s);
  }
  // Kontrol modu: her oyuncunun kendi tercihi (aga gitmez)
  const CTRL_HINT = {
    offset: 'Paddle parmağının biraz üstünde durur, böylece vuruşu görürsün. Kalene yaklaştıkça parmağına iner.',
    drag: 'Parmağını kendi yarı sahanda istediğin yere koy ve kaydır; paddle o kadar hareket eder.'
  };
  function applyCtrl(m) {
    const c = m === 'drag' ? 'drag' : 'offset';
    save('ah_ctrl', c);
    Game.setControl(c);
    UI.markCtrl(c);
    UI.$('ctrl-hint').textContent = CTRL_HINT[c];
  }
  function applySkin(name) {
    const sk = name === 'arcade' ? 'arcade' : 'neon';
    save('ah_skin', sk);
    session.skin = sk;
    Game.setSkin(sk);
    UI.markSkin(sk);
    document.body.classList.toggle('skin-arcade', sk === 'arcade');
  }
  function applyRules(r) {
    session.rules = RULE_TXT[r] ? r : 'first7';
    save('ah_rules', session.rules);
    summarize();
  }
  function applyDiff(d) {
    session.difficulty = DIFF_TXT[d] ? d : 'normal';
    save('ah_diff', session.difficulty);
    summarize();
  }
  function cap(s) { return s.charAt(0).toLocaleUpperCase('tr') + s.slice(1); }
  function summarize() {
    UI.$('ai-summary').textContent = DIFF_TXT[session.difficulty] + ', ' + RULE_TXT[session.rules];
    UI.$('wait-summary').textContent = cap(RULE_TXT[session.rules]) + ', ' + PUCK_TXT[session.puck];
  }
  // Misafir: maca KURANIN gorunum+puck'ini uygula (kendi tercihini
  // localStorage'da bozmadan; sadece bu mac icin)
  function useMatchLook(skin, puck) {
    const sk = skin === 'arcade' ? 'arcade' : 'neon';
    Game.setSkin(sk);
    document.body.classList.toggle('skin-arcade', sk === 'arcade');
    Game.setPuckSize(puck);   // gecersizse setPuckSize 'med'e duser
  }

  let settingsFrom = 'lobby';
  function openSettings() { settingsFrom = UI.screen(); UI.show('settings'); }
  function closeSettings() {
    UI.show(settingsFrom === 'end' ? 'end' : 'lobby');
    if (settingsFrom === 'end') UI.ready(online(), ready.me, ready.op);
  }

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.name === 'rules') applyRules(t.value);
    else if (t.name === 'ai-diff') applyDiff(t.value);
  });

  // --- Dokunma (event delegation) ---
  const ACTIONS = {
    'open-settings': openSettings,
    'close-settings': closeSettings,
    'invite': () => createRoom(newCode(), true),
    'show-join': () => UI.lobbyMode('join'),
    'show-create': () => { if (online()) { Net.leave(); session.role = null; } UI.show('lobby'); UI.lobbyMode('create'); },
    'back': () => UI.lobbyMode('home'),
    'cancel-wait': () => { Net.leave(); goHome(); },
    'share': shareInvite,
    'copy-code': copyCode,
    'pause': openPause,
    'resume': closePause,
    'ask-exit': () => askConfirm('exit'),
    'ask-restart': () => askConfirm('restart'),
    'confirm-no': closePause,
    'confirm-yes': confirmYes,
    'to-lobby': () => { if (online()) Net.leave(); goHome(); },
    'rematch': rematch
  };
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-skin],[data-puck],[data-ctrl],[data-sound],[data-action]');
    if (!el || el.disabled) return;
    const d = el.dataset;
    if (d.skin) applySkin(d.skin);
    else if (d.puck) { applyPuck(d.puck); summarize(); }
    else if (d.ctrl) applyCtrl(d.ctrl);
    else if (d.sound) applySound(d.sound === 'on');
    else if (ACTIONS[d.action]) ACTIONS[d.action]();
  });

  // --- Duraklat menusu: tek kisilikte oyun durur, online'da surer ---
  const pauseEl = UI.$('pause');
  const pauseOpen = () => !pauseEl.classList.contains('hidden');
  let confirmKind = null;
  function pauseView(confirm) {
    UI.$('pause-menu').classList.toggle('hidden', confirm);
    UI.$('pause-confirm').classList.toggle('hidden', !confirm);
  }
  function openPause() {
    if (UI.screen() !== 'game' || pauseOpen()) return;
    UI.$('pause-title').textContent = session.ai ? 'Duraklatıldı' : 'Menü';
    UI.$('pause-note').textContent = session.ai ? '' : 'Oyun arkada devam ediyor.';
    UI.$('pause-restart').classList.toggle('hidden', !session.ai);
    pauseView(false);
    pauseEl.classList.remove('hidden');
    if (session.ai) Game.stop();
    UI.$('pause-resume').focus();
  }
  function hidePause() { pauseEl.classList.add('hidden'); confirmKind = null; }
  function closePause() {
    if (!pauseOpen()) return;
    hidePause();
    if (session.ai && UI.screen() === 'game') Game.resume();
  }
  function askConfirm(kind) {
    confirmKind = kind;
    const exit = kind === 'exit';
    UI.$('confirm-title').textContent = exit ? 'Çıkmak istediğinize emin misiniz?' : 'Yeniden başlamak istediğinize emin misiniz?';
    UI.$('confirm-note').textContent = !exit ? 'Skor sıfırlanır.'
      : session.ai ? 'Çıkarsanız bu maç silinir.' : 'Oyun arkada devam ediyor. Çıkarsanız maç sona erer.';
    UI.$('confirm-yes').textContent = exit ? 'Evet, çık' : 'Evet, yeniden başla';
    pauseView(true);
    UI.$('confirm-no').focus();
  }
  function confirmYes() {
    const kind = confirmKind;
    hidePause();
    if (kind === 'restart') { startAi(); return; }
    if (online()) Net.leave();       // 'bye' rakibe ulassin
    goHome();
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (UI.screen() === 'settings') closeSettings();
    else if (UI.screen() === 'game') { if (pauseOpen()) closePause(); else openPause(); }
  });

  // --- Rovans: online'da IKI taraf da hazir olunca baslar (karar host'ta) ---
  function rematch() {
    if (session.ai) { startAi(); return; }
    if (!online() || ready.me) return;
    ready.me = true;
    UI.ready(true, ready.me, ready.op);
    Net.rematchRequest();
    tryRematch();
  }
  function tryRematch() {
    if (session.role !== 'host' || !ready.me || !ready.op) return;
    const d = { rules: session.rules, skin: session.skin, puck: session.puck };
    Net.rematch(d);
    Game.setSkin(d.skin); Game.setPuckSize(d.puck);
    enterGame({ role: 'host', rules: d.rules });
  }

  // --- Oda kodu + davet linki (#oda=<kod>, acan kisi otomatik katilir) ---
  const CODE_CHARS = 'ABCDEFGHJKMNPRTUVYZ2346789';   // karisan harf/rakam yok (0/O, 1/I/L, 5/S)
  function newCode() {
    let s = '';
    for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }
  let autoCode = false, codeTries = 0;
  function createRoom(pw, auto) {
    autoCode = !!auto;
    if (!auto) codeTries = 0;
    session.ai = false;
    session.password = pw;
    document.activeElement && document.activeElement.blur();   // klavyeyi kapat
    setBusy(true, auto ? 'Oda hazırlanıyor...' : 'Bağlanıyor...');
    Net.createRoom(pw, session.rules, session.skin, session.puck);
  }
  function inviteUrl(pw) { return location.href.split('#')[0] + '#oda=' + encodeURIComponent(pw); }
  function note(t) { UI.$('share-note').textContent = t; }
  async function shareInvite() {
    const url = inviteUrl(session.password);
    const text = 'Air Hockey oynayalım! Kod: ' + session.password;
    if (navigator.share) {
      try { await navigator.share({ title: 'Air Hockey', text, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text + '\n' + url); note('Link kopyalandı, arkadaşına gönder.'); }
    catch (e) { note(url); }
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(session.password); note('Kod kopyalandı.'); }
    catch (e) { note('Kopyalanamadı. Kodu elle gönder: ' + session.password); }
  }

  // --- Baglanirken cift dokunmayi engelle + durum goster ---
  function setBusy(on, msg) {
    document.querySelectorAll('#form-create [type=submit], #form-join [type=submit], #invite-btn')
      .forEach((b) => { b.disabled = on; });
    if (on) UI.lobbyInfo(msg || 'Bağlanıyor...');
  }

  // --- Ekran degisince: ekran kararmasin + geri kaydirma maci bozmasin ---
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        const w = wakeLock; wakeLock = null; await w.release();
      }
    } catch (e) { wakeLock = null; }
  }
  const live = (n) => n === 'wait' || n === 'game' || ((n === 'end' || n === 'settings') && online());
  UI.onShow((name) => {
    hidePause();                        // mac bitti / rakip cikti / yeni mac
    if (name === 'lobby') setBusy(false);
    if (name === 'wait') { note(''); summarize(); }
    if (name === 'end' || name === 'lobby') UI.$('look-hint').classList.toggle('hidden', session.ai);
    keepAwake(live(name));
    // iOS kenardan geri kaydirma sayfadan cikarmasin: fazladan gecmis kaydi
    if (live(name) && !(history.state && history.state.ah)) {
      try { history.pushState({ ah: 1 }, ''); } catch (e) {}
    }
  });
  window.addEventListener('popstate', () => {
    if (live(UI.screen())) {
      try { history.pushState({ ah: 1 }, ''); } catch (e) {}
      if (UI.screen() === 'game') openPause();     // geri hareketi = menu
    } else if (UI.screen() === 'settings') closeSettings();
  });
  document.addEventListener('visibilitychange', () => {
    // Wake lock arka plana gecince birakilir; donunce yeniden al
    if (document.visibilityState === 'visible') keepAwake(live(UI.screen()));
    else if (session.ai && UI.screen() === 'game') openPause();   // arka planda duraklat
  });

  // Telefon yan cevrildi: tek kisilikte oyun uyarinin arkasinda akmasin
  if (window.matchMedia) {
    const side = matchMedia('(orientation: landscape) and (max-height: 520px)');
    if (side.addEventListener) side.addEventListener('change', () => { if (side.matches && session.ai) openPause(); });
  }

  UI.$('form-ai').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const d = document.querySelector('input[name="ai-diff"]:checked');
    if (d) applyDiff(d.value);
    resetSeries();
    startAi();
  });
  UI.$('form-create').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const pw = UI.$('create-password').value.trim();
    if (!pw) { UI.lobbyError('Bir şifre yaz.'); return; }
    createRoom(pw, false);
  });
  UI.$('form-join').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const pw = UI.$('join-password').value.trim();
    if (!pw) { UI.lobbyError('Arkadaşının kodunu yaz.'); return; }
    session.ai = false;
    session.password = pw;
    document.activeElement && document.activeElement.blur();
    setBusy(true, 'Bağlanıyor...');
    Net.joinRoom(pw);
  });

  // --- Ag olaylari ---
  Net.on('room_created', (d) => {
    codeTries = 0;
    session.role = 'host';
    session.password = d.password;
    UI.waitPassword(d.password);
    UI.show('wait');
  });

  Net.on('peer_joined', () => {       // Host: misafir geldi, mac basliyor
    resetSeries();
    Game.setSkin(session.skin); Game.setPuckSize(session.puck);
    enterGame({ role: 'host', rules: session.rules });
  });

  let matchRules = 'first7';          // misafir: kuranin kurali (kendi tercihi bozulmaz)
  Net.on('joined', (d) => {
    session.role = 'guest';
    resetSeries();
    matchRules = d.rules;
    useMatchLook(d.skin, d.puck);     // kuranin gorunum + puck'i gecerli
    enterGame({ role: 'guest', rules: matchRules });
  });

  Net.on('error_msg', (d) => {
    // Otomatik kod doluysa sessizce yeni kod dene
    if (d && d.code === 'password_taken' && autoCode && codeTries++ < 5) { createRoom(newCode(), true); return; }
    codeTries = 0;
    session.role = null;
    UI.show('lobby');
    UI.lobbyError(d && d.message ? d.message : 'Bir hata oluştu.');
  });

  // Rakip GECICI koptu (grace): oyun iki tarafta da durur, geri sayim gosterilir.
  let dropT = null;
  function stopDropTimer() { clearInterval(dropT); dropT = null; }
  Net.on('peer_dropped', (d) => {
    if (session.ai) return;
    const end = performance.now() + ((d && d.ms) || 25000);
    const tick = () => {
      const s = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      UI.netMsg(session.role === 'guest'
        ? 'Bağlantı koptu. Yeniden bağlanılıyor: ' + s + ' sn'
        : 'Rakibin bağlantısı koptu. Bekleniyor: ' + s + ' sn');
    };
    stopDropTimer(); tick();
    dropT = setInterval(tick, 500);
    UI.ping(false);
    if (UI.screen() === 'game') Game.stop();
  });
  Net.on('peer_back', () => {
    stopDropTimer();
    UI.netMsg('');
    if (UI.screen() === 'game') Game.resume();
    if (ready.me) Net.rematchRequest();     // kopmada kaybolmus olabilir
  });

  Net.on('peer_left', (d) => {
    stopDropTimer();
    UI.netMsg('');
    Game.stop();
    if (d && d.who === 'guest' && session.role === 'host') {
      resetReady();
      UI.waitPassword(session.password);    // oda ayni kodla bekliyor
      UI.show('wait');
      note('Rakip oyundan çıktı. Oda açık, yeniden katılabilir.');
    } else {
      goHome('Rakip oyundan çıktı.');
    }
  });

  // Host yeni maci baslatti -> misafir oyuna donsun (kural/gorunum degismis olabilir)
  Net.on('rematch', (d) => {
    if (session.role !== 'guest') return;
    if (d) { matchRules = d.rules; useMatchLook(d.skin, d.puck); }
    enterGame({ role: 'guest', rules: matchRules });
  });
  Net.on('rematch_request', () => {         // rakip hazir
    ready.op = true;
    UI.ready(true, ready.me, ready.op);
    tryRematch();
  });

  // Baglanti gostergesi
  setInterval(() => UI.ping(online() && UI.screen() === 'game' && !dropT, Net.rtt()), 500);

  // --- Baslangic: kayitli tercihler + lobi ---
  applySkin(load('ah_skin', 'neon'));
  // Telefonda (dokunmatik) varsayilan puck buyuk: parmak altinda daha iyi gorunur
  const touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  applyPuck(load('ah_puck', touch ? 'large' : 'med'));
  applyCtrl(load('ah_ctrl', 'offset'));
  applySound(load('ah_sound', 'on') !== 'off');
  applyRules(load('ah_rules', 'first7'));
  applyDiff(load('ah_diff', 'normal'));
  document.querySelectorAll('input[name="rules"]').forEach((r) => { r.checked = r.value === session.rules; });
  document.querySelectorAll('input[name="ai-diff"]').forEach((r) => { r.checked = r.value === session.difficulty; });
  UI.show('lobby');
  UI.lobbyMode('home');

  // Davet linkiyle acildiysa (#oda=...) dogrudan katil
  const inv = location.hash.match(/^#oda=(.+)$/);
  if (inv) {
    let pw = '';
    try { pw = decodeURIComponent(inv[1]).trim(); } catch (e) {}
    try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) {}
    if (pw) {
      UI.lobbyMode('join');
      UI.$('join-password').value = pw;
      UI.$('form-join').requestSubmit();
    }
  }
})();
