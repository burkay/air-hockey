// Akis kontrolu: lobi -> bekleme -> oyun -> bitis ve ag olaylari.

(() => {
  const session = { role: null, password: '', rules: 'first7', ai: false, difficulty: 'normal' };
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
    Game.setPuckSize(s);
    UI.markPuck(s);
  }

  function selectedRules() {
    const r = document.querySelector('input[name="rules"]:checked');
    return r ? r.value : 'first7';
  }

  function applySkin(name) {
    const sk = name === 'arcade' ? 'arcade' : 'neon';
    try { localStorage.setItem('ah_skin', sk); } catch (e) {}
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

    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;

    if (a === 'show-ai') UI.lobbyMode('ai');
    else if (a === 'show-create') UI.lobbyMode('create');
    else if (a === 'show-join') UI.lobbyMode('join');
    else if (a === 'back') UI.lobbyMode('home');
    else if (a === 'cancel-wait') { Net.leave(); UI.show('lobby'); UI.lobbyMode('home'); }
    else if (a === 'to-lobby') { if (!session.ai) Net.leave(); location.reload(); }
    else if (a === 'rematch') {
      if (session.ai) {
        restartGame();
      } else if (session.role === 'host') {
        restartGame();
        Net.rematch();
      } else {
        Net.rematchRequest();
        UI.$('end-note').textContent = 'Rakipten yeni mac onayi bekleniyor...';
      }
    }
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
    if (!pw) { UI.lobbyError('Lutfen bir sifre gir.'); return; }
    session.ai = false;
    session.password = pw;
    session.rules = selectedRules();
    Net.createRoom(pw, session.rules);
  });

  UI.$('form-join').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const pw = UI.$('join-password').value.trim();
    if (!pw) { UI.lobbyError('Lutfen sifreyi gir.'); return; }
    session.ai = false;
    session.password = pw;
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
    enterGame({ role: 'guest', rules: d.rules });
  });

  Net.on('error_msg', (d) => {
    UI.show('lobby');
    UI.lobbyError(d && d.message ? d.message : 'Bir hata olustu.');
  });

  // Rakip GECICI koptu (grace icinde): oyun durmaz, sadece bilgi ver.
  Net.on('peer_dropped', () => {
    if (!session.ai) UI.netMsg('Rakip baglantisi koptu, bekleniyor...');
  });
  // Rakip geri geldi.
  Net.on('peer_back', () => UI.netMsg(''));
  // Kendi yeniden baglanmamiz onaylandi.
  Net.on('resumed', () => UI.netMsg(''));

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
      UI.lobbyError('Rakip baglantiyi kapatti.');
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

  // Baglanti durumu + otomatik yeniden katilma
  Net.socket.on('disconnect', () => {
    if (!session.ai && session.role) {
      UI.netMsg('Baglanti koptu, yeniden baglaniliyor...');
    }
  });
  Net.socket.on('connect', () => {
    // Oturum varsa bu bir YENIDEN baglanma -> eski yeri geri al.
    if (!session.ai && session.role && session.password) {
      Net.resume(session.password, session.role);
    }
  });

  // Baslangic: kayitli skin + puck tercihini uygula + lobi
  let savedSkin = 'neon';
  try { savedSkin = localStorage.getItem('ah_skin') || 'neon'; } catch (e) {}
  applySkin(savedSkin);
  let savedPuck = 'med';
  try { savedPuck = localStorage.getItem('ah_puck') || 'med'; } catch (e) {}
  applyPuck(savedPuck);
  UI.show('lobby');
  UI.lobbyMode('home');
})();
