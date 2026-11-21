// Akis kontrolu: lobi -> bekleme -> oyun -> bitis ve ag olaylari.

(() => {
  const session = { role: null, password: '', rules: 'first7', ai: false, difficulty: 'normal', skin: 'neon', puck: 'med' };
  const canvas = UI.$('board');

  Game.init(canvas, {
    onHud: UI.hud,
    onMessage: UI.message,
    onGameOver: (result, scoreLine) => {
      if (typeof Sfx !== 'undefined') (result === 'win' ? Sfx.win() : result === 'lose' ? Sfx.lose() : Sfx.win());
      UI.endScreen(result, scoreLine);
    }
  });

  function enterGame(opts) {
    UI.resetScores();
    UI.show('game');
    Game.start(opts);
  }

  function restartGame() {
    UI.resetScores();
    UI.show('game');
    Game.restart();
    Game.layout();
  }

  // iOS: ses ilk kullanici hareketinde acilmali (AudioContext)
  // iOS: ses, jest icinde acilmali. pointerdown bazi iOS surumlerinde
  // yetmez; touchend/click daha guvenilir -> hepsine bagla (idempotent).
  ['pointerdown', 'touchend', 'click'].forEach((ev) =>
    document.addEventListener(ev, () => Sfx.unlock(), { passive: true }));

  const muteBtn = UI.$('mute-btn');
  muteBtn.addEventListener('click', () => {
    const m = Sfx.toggleMute();
    muteBtn.textContent = m ? '🔇' : '🔊';
  });

  function applyPuck(size) {
    const s = (size === 'small' || size === 'large') ? size : 'med';
    try { localStorage.setItem('ah_puck', s); } catch (e) {}
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
    try { localStorage.setItem('ah_ctrl', c); } catch (e) {}
    Game.setControl(c);
    document.querySelectorAll('[data-ctrl]').forEach((b) =>
      b.classList.toggle('active', b.dataset.ctrl === c));
    UI.$('ctrl-hint').textContent = CTRL_HINT[c];
  }

  // Misafir: maca KURANIN gorunum+puck'ini uygula (kendi tercihini
  // localStorage'da bozmadan; sadece bu mac icin)
  function useMatchLook(skin, puck) {
    const sk = skin === 'arcade' ? 'arcade' : 'neon';
    Game.setSkin(sk);
    document.body.classList.toggle('skin-arcade', sk === 'arcade');
    Game.setPuckSize(puck);   // gecersizse setPuckSize 'med'e duser
  }

  function selectedRules() {
    const r = document.querySelector('input[name="rules"]:checked');
    return r ? r.value : 'first7';
  }

  function applySkin(name) {
    const sk = name === 'arcade' ? 'arcade' : 'neon';
    try { localStorage.setItem('ah_skin', sk); } catch (e) {}
    session.skin = sk;
    Game.setSkin(sk);
    UI.markSkin(sk);
    document.body.classList.toggle('skin-arcade', sk === 'arcade');
  }

  // --- Lobi etkilesimleri (event delegation) ---
  document.addEventListener('click', (ev) => {
    const skinEl = ev.target.closest('[data-skin]');
    if (skinEl) { applySkin(skinEl.dataset.skin); return; }

    const puckEl = ev.target.closest('[data-puck]');
    if (puckEl) { applyPuck(puckEl.dataset.puck); return; }

    const ctrlEl = ev.target.closest('[data-ctrl]');
    if (ctrlEl) { applyCtrl(ctrlEl.dataset.ctrl); return; }

    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;

    if (a === 'show-ai') UI.lobbyMode('ai');
    else if (a === 'show-create') UI.lobbyMode('create');
    else if (a === 'show-join') UI.lobbyMode('join');
    else if (a === 'back') UI.lobbyMode('home');
    else if (a === 'cancel-wait') { Net.leave(); UI.show('lobby'); UI.lobbyMode('home'); }
    else if (a === 'to-lobby') {
      if (session.ai) { location.reload(); return; }
      Net.leave();                                   // 'bye' rakibe ulassin
      setTimeout(() => location.reload(), 200);
    }
    else if (a === 'rematch') {
      if (session.ai) {
        restartGame();
      } else if (session.role === 'host') {
        restartGame();
        Net.rematch();
      } else {
        Net.rematchRequest();
        UI.$('end-note').textContent = 'Rakipten yeni maç onayı bekleniyor...';
      }
    }
    else if (a === 'share') shareInvite();
  });

  // --- Davet linki: #oda=<sifre> (acan kisi otomatik katilir) ---
  function inviteUrl(pw) {
    return location.href.split('#')[0] + '#oda=' + encodeURIComponent(pw);
  }
  async function shareInvite() {
    const url = inviteUrl(session.password);
    const text = 'Air Hockey oynayalım! Şifre: ' + session.password;
    const note = UI.$('share-note');
    if (navigator.share) {
      try { await navigator.share({ title: 'Air Hockey', text, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text + '\n' + url);
      note.textContent = 'Link kopyalandı, arkadaşına gönder.';
    } catch (e) {
      note.textContent = url;
    }
  }

  // --- Baglanirken cift dokunmayi engelle + durum goster ---
  function setBusy(on) {
    document.querySelectorAll('#form-create [type=submit], #form-join [type=submit]')
      .forEach((b) => { b.disabled = on; });
    if (on) UI.lobbyInfo('Bağlanıyor...');
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
  const live = (n) => n === 'wait' || n === 'game' || (n === 'end' && !session.ai);
  UI.onShow((name) => {
    if (name === 'lobby') setBusy(false);
    if (name === 'wait') UI.$('share-note').textContent =
      'Arkadaşın linki açınca ya da "Katıl"a basıp bu şifreyi girince oyun başlar.';
    keepAwake(live(name));
    // iOS kenardan geri kaydirma sayfadan cikarmasin: fazladan gecmis kaydi
    if (live(name) && !(history.state && history.state.ah)) {
      try { history.pushState({ ah: 1 }, ''); } catch (e) {}
    }
  });
  window.addEventListener('popstate', () => {
    if (live(UI.screen())) { try { history.pushState({ ah: 1 }, ''); } catch (e) {} }
  });
  document.addEventListener('visibilitychange', () => {
    // Wake lock arka plana gecince birakilir; donunce yeniden al
    if (document.visibilityState === 'visible') keepAwake(live(UI.screen()));
  });

  UI.$('form-ai').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const r = document.querySelector('input[name="ai-rules"]:checked');
    const d = document.querySelector('input[name="ai-diff"]:checked');
    session.ai = true;
    session.role = 'host';
    session.rules = r ? r.value : 'first7';
    session.difficulty = d ? d.value : 'normal';
    enterGame({ role: 'host', rules: session.rules, ai: true, difficulty: session.difficulty });
  });

  UI.$('form-create').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const pw = UI.$('create-password').value.trim();
    if (!pw) { UI.lobbyError('Lütfen bir şifre gir.'); return; }
    session.ai = false;
    session.password = pw;
    session.rules = selectedRules();
    document.activeElement && document.activeElement.blur();   // klavyeyi kapat
    setBusy(true);
    Net.createRoom(pw, session.rules, session.skin, session.puck);
  });

  UI.$('form-join').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const pw = UI.$('join-password').value.trim();
    if (!pw) { UI.lobbyError('Lütfen şifreyi gir.'); return; }
    session.ai = false;
    session.password = pw;
    document.activeElement && document.activeElement.blur();   // klavyeyi kapat
    setBusy(true);
    Net.joinRoom(pw);
  });

  // --- Ag olaylari ---
  Net.on('room_created', (d) => {
    session.role = 'host';
    session.password = d.password;
    session.rules = d.rules;
    UI.waitPassword(d.password);
    UI.show('wait');
  });

  Net.on('peer_joined', () => {
    // Host: misafir geldi, mac basliyor
    enterGame({ role: 'host', rules: session.rules });
  });

  Net.on('joined', (d) => {
    session.role = 'guest';
    session.rules = d.rules;
    useMatchLook(d.skin, d.puck);   // kuranin gorunum + puck'i gecerli
    enterGame({ role: 'guest', rules: d.rules });
  });

  Net.on('error_msg', (d) => {
    UI.show('lobby');
    UI.lobbyError(d && d.message ? d.message : 'Bir hata oluştu.');
  });

  // Rakip GECICI koptu (grace icinde): oyun durmaz, sadece bilgi ver.
  Net.on('peer_dropped', () => {
    if (!session.ai) UI.netMsg('Rakibin bağlantısı koptu, bekleniyor...');
  });
  // Rakip geri geldi (yeniden baglanmayi net.js kendisi yapar).
  Net.on('peer_back', () => UI.netMsg(''));

  Net.on('peer_left', (d) => {
    UI.netMsg('');
    Game.stop();
    if (d && d.who === 'guest' && session.role === 'host') {
      // Misafir ayrildi: oda ayni sifreyle bekliyor
      UI.waitPassword(session.password);
      UI.show('wait');
    } else {
      // Host ayrildi (misafir tarafi)
      UI.show('lobby');
      UI.lobbyMode('home');
      UI.lobbyError('Rakip oyundan çıktı.');
    }
  });

  // Host yeni mac baslatti -> misafir oyun ekranina donsun
  Net.on('rematch', () => {
    restartGame();
  });

  // Misafir yeni mac istedi -> host otomatik baslatir
  Net.on('rematch_request', () => {
    if (session.role !== 'host') return;
    restartGame();
    Net.rematch();
  });

  // Baslangic: kayitli skin + puck tercihini uygula + lobi
  let savedSkin = 'neon';
  try { savedSkin = localStorage.getItem('ah_skin') || 'neon'; } catch (e) {}
  applySkin(savedSkin);
  // Telefonda (dokunmatik) varsayilan puck buyuk: parmak altinda daha iyi gorunur
  const touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  let savedPuck = touch ? 'large' : 'med';
  try { savedPuck = localStorage.getItem('ah_puck') || savedPuck; } catch (e) {}
  applyPuck(savedPuck);
  let savedCtrl = 'offset';
  try { savedCtrl = localStorage.getItem('ah_ctrl') || 'offset'; } catch (e) {}
  applyCtrl(savedCtrl);
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
