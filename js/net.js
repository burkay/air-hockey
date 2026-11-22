// Ag katmani: WebRTC ile dogrudan (peer-to-peer) baglanti, PeerJS uzerinden.
// Kendi sunucumuz yok: PeerJS'in ucretsiz genel sunucusu yalnizca eslestirme
// (signaling) yapar; oyun verisi iki cihaz arasinda dogrudan akar. Dogrudan
// yol kurulamazsa PeerJS'in varsayilan TURN rolesi (AB/ABD) devreye girer.
//
// Disariya verilen olaylar eski Socket.IO surumuyle ayni:
// room_created, joined, peer_joined, error_msg, peer_dropped, peer_back,
// peer_left, state, input, rematch, rematch_request.

const Net = (() => {
  const APP = 'bk-airhockey-v2-';
  const GRACE_MS = 25000;   // kopmada rakibi bu kadar bekle
  const SILENT_MS = 4000;   // bu kadar veri gelmezse baglanti koptu say
  const PING_MS = 500;      // bosta kalinca canli-tut mesaji
  const JOIN_MS = 15000;    // ilk katilma zaman asimi
  const RETRY_MS = 2000;    // misafir yeniden arama araligi
  const handlers = {};
  function emit(ev, d) { (handlers[ev] || []).forEach((fn) => fn(d)); }

  // Sifre -> PeerJS kimligi (sifrenin kendisi sunucuya gitmez, ozeti gider).
  // Buyuk/kucuk harf ve bosluk farki onemsiz: iOS klavyesi ilk harfi buyutebilir.
  // i/ı/İ/I hepsi 'i' sayilir: Turkce klavye 'i'yi 'İ', Ingilizce 'I' yapar;
  // toLocaleLowerCase('tr') ise 'I'yi 'ı' yapip ayni sifreyi farkli odaya goturur.
  function roomId(pw) {
    const s = String(pw).trim().replace(/\s+/g, ' ').replace(/[İIıi]/g, 'i').toLowerCase();
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return APP + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }

  let peer = null;        // kendi PeerJS nesnemiz
  let conn = null;        // rakiple acik veri kanali
  let role = null;        // 'host' | 'guest'
  let hostId = null;      // misafir: aranacak kimlik
  let look = null;        // host: { rules, skin, puck }
  let token = null;       // misafir: kendi kimligi (yeniden baglanmada ayni kisi mi?)
  let guestToken = null;  // host: su anki misafirin kimligi
  let opened = false;     // host: oda acildi / misafir: maca katildi
  let lastRx = 0, lastPing = 0;
  let rttMs = 0;          // suzulmus gidis-donus suresi (ms)
  let graceT = null, retryT = null, joinT = null, hb = null;

  function stop(t) { if (t) clearTimeout(t); return null; }
  function clearTimers() { graceT = stop(graceT); retryT = stop(retryT); joinT = stop(joinT); }

  function closeConn() {
    const c = conn;
    conn = null;            // once null: close olayi dropConn'u tetiklemesin
    if (c) { try { c.close(); } catch (e) {} }
  }

  function send(msg) {
    if (!conn || !conn.open) return;
    try { conn.send(msg); } catch (e) {}
  }

  // Canli-tut + sessizlik algilama (WebRTC 'close' olayi gec gelebilir)
  function startHeartbeat() {
    if (hb) return;
    hb = setInterval(() => {
      if (!conn || !conn.open) return;
      const now = performance.now();
      // Gecikme olcumu: ts geri yansir (pong). Oyun sirasinda da surer.
      if (now - lastPing > PING_MS) { lastPing = now; send({ t: 'ping', ts: now }); }
      if (now - lastRx > SILENT_MS) dropConn();
    }, 250);
  }

  function makePeer(id) {
    const p = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    // Eslestirme sunucusu baglantisi koparsa (iOS arka plan vb.) ayni kimlikle geri don.
    // Acik veri kanali bundan etkilenmez.
    p.on('disconnected', () => setTimeout(() => { if (peer === p) wake(); }, 1000));
    return p;
  }

  // Sunucuya yeniden baglan (gerekiyorsa). reconnect() yanlis durumda hata atar.
  function wake() {
    const p = peer;
    if (!p || p.destroyed || !p.disconnected) return;
    try { p.reconnect(); } catch (e) {}
  }
  // Uygulamaya geri donuldu (or. WhatsApp'tan): beklemeden yeniden baglan.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });

  function onData(c, m) {
    if (c !== conn || !m) return;
    lastRx = performance.now();
    switch (m.t) {
      case 's': emit('state', m.d); break;
      case 'i': emit('input', m.d); break;
      case 'rm': emit('rematch', m.d); break;
      case 'rq': emit('rematch_request'); break;
      case 'ping': if (m.ts != null) send({ t: 'pong', ts: m.ts }); break;
      case 'pong': {
        const r = performance.now() - m.ts;
        if (r >= 0 && r < 2000) rttMs = rttMs ? rttMs + (r - rttMs) * 0.2 : r;
        break;
      }
      case 'bye': leftNow(); break;
      case 'full': fail('room_full', 'Bu oyun dolu.'); break;
      case 'hello':
        joinT = stop(joinT); graceT = stop(graceT); retryT = stop(retryT);
        if (opened) emit('peer_back');
        else { opened = true; emit('joined', { rules: m.rules, skin: m.skin, puck: m.puck }); }
        break;
    }
  }

  // Rakip bilerek cikti
  function leftNow() {
    if (role === 'host') {
      closeConn();
      guestToken = null;
      graceT = stop(graceT);
      emit('peer_left', { who: 'guest' });
    } else {
      teardown();
      emit('peer_left', { who: 'host' });
    }
  }

  // Baglanti koptu (gecici olabilir): grace boyunca bekle / yeniden dene
  function dropConn() {
    if (!conn) return;
    closeConn();
    if (role === 'host') {
      emit('peer_dropped', { who: 'guest', ms: GRACE_MS });
      stop(graceT);
      graceT = setTimeout(() => {
        graceT = null; guestToken = null;
        emit('peer_left', { who: 'guest' });
      }, GRACE_MS);
    } else if (!opened) {
      fail('p2p_fail', 'Rakibe bağlanılamadı. Biriniz Wi-Fi ile mobil veri arasında geçiş yapıp tekrar denesin.');
    } else {
      emit('peer_dropped', { who: 'host', ms: GRACE_MS });
      stop(graceT);
      graceT = setTimeout(() => { teardown(); emit('peer_left', { who: 'host' }); }, GRACE_MS);
      retry();
    }
  }

  // --- Misafir ---
  function dial() {
    if (!peer || peer.destroyed) return;
    if (peer.disconnected) { peer.reconnect(); return; }   // 'open' gelince tekrar arar
    closeConn();
    const c = peer.connect(hostId, { reliable: true, serialization: 'json', metadata: { token } });
    conn = c;
    c.on('open', () => {
      if (c !== conn) return;
      lastRx = performance.now();
      startHeartbeat();
    });
    c.on('data', (m) => onData(c, m));
    c.on('close', () => { if (c === conn) dropConn(); });
    c.on('error', () => {});
  }
  function retry() {
    retryT = stop(retryT);
    retryT = setTimeout(() => {
      retryT = null;
      if (!graceT || (conn && conn.open)) return;
      dial();
      retry();
    }, RETRY_MS);
  }

  // --- Host ---
  function onConnection(c) {
    const t = c.metadata && c.metadata.token;
    const same = !!t && t === guestToken;     // ayni misafir geri dondu
    c.on('open', () => {
      const busy = !same && ((conn && conn.open) || graceT);
      if (busy) {
        try { c.send({ t: 'full' }); } catch (e) {}
        setTimeout(() => { try { c.close(); } catch (e) {} }, 300);
        return;
      }
      closeConn();
      conn = c;
      graceT = stop(graceT);
      guestToken = t;
      lastRx = performance.now();
      startHeartbeat();
      send({ t: 'hello', rules: look.rules, skin: look.skin, puck: look.puck });
      emit(same ? 'peer_back' : 'peer_joined');
    });
    c.on('data', (m) => onData(c, m));
    c.on('close', () => { if (c === conn) dropConn(); });
    c.on('error', () => {});
  }

  // Sekme kimligi: sayfa yenilense de ayni kalir -> host ayni misafiri tanir
  // (yoksa yenileyen oyuncu eski baglantisi dusene kadar "dolu" aliyordu).
  function tabToken() {
    let t = token;
    try { t = t || sessionStorage.getItem('ah_token'); } catch (e) {}
    t = t || Math.random().toString(36).slice(2);
    try { sessionStorage.setItem('ah_token', t); } catch (e) {}
    return t;
  }

  function teardown() {
    clearTimers();
    clearInterval(hb); hb = null;
    closeConn();
    const p = peer;
    peer = null;
    if (p) { try { p.destroy(); } catch (e) {} }
    rttMs = 0;
    role = hostId = look = guestToken = null;
    opened = false;
  }

  function fail(code, message) {
    teardown();
    emit('error_msg', { code, message });
  }

  function noLib() {
    if (typeof Peer !== 'undefined') return false;
    emit('error_msg', { code: 'no_lib', message: 'Bağlantı kütüphanesi yüklenemedi. İnterneti kontrol edip sayfayı yenile.' });
    return true;
  }

  return {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },

    createRoom(password, rules, skin, puck) {
      if (noLib()) return;
      teardown();
      role = 'host';
      look = { rules, skin, puck };
      const p = makePeer(roomId(password));
      peer = p;
      p.on('open', () => {
        if (peer !== p || opened) return;   // sunucuya yeniden baglanmada tekrar yollama
        opened = true;
        emit('room_created', { password, rules, skin, puck });
      });
      p.on('connection', onConnection);
      p.on('error', (err) => {
        if (peer !== p) return;
        if (err.type === 'unavailable-id') fail('password_taken', 'Bu şifre kullanımda, başka bir şifre seç.');
        else if (!opened) fail('net', 'Eşleştirme sunucusuna ulaşılamadı. Tekrar dene.');
      });
    },

    joinRoom(password) {
      if (noLib()) return;
      teardown();
      role = 'guest';
      hostId = roomId(password);
      token = tabToken();
      const p = makePeer(null);
      peer = p;
      p.on('open', () => { if (peer === p && !(conn && conn.open)) dial(); });
      // Not: PeerJS sunucusu henuz bagli olmayan kimlige giden teklifi birkac
      // saniye bekletir; host o an baska uygulamadaysa ve doner donmez
      // yeniden baglanirsa (visibilitychange -> wake) katilma yine olur.
      p.on('error', (err) => {
        if (peer !== p || opened) return;   // macta yeniden denemede gecici hatalar normal
        if (err.type === 'peer-unavailable') fail('no_room', 'Bu kodla açık bir oyun yok. Arkadaşının ekranı açık mı?');
        else fail('net', 'Eşleştirme sunucusuna ulaşılamadı. Tekrar dene.');
      });
      joinT = setTimeout(() => {
        joinT = null;
        if (!opened) fail('p2p_fail', 'Rakibe bağlanılamadı. Biriniz Wi-Fi ile mobil veri arasında geçiş yapıp tekrar denesin.');
      }, JOIN_MS);
    },

    rtt() { return rttMs; },
    sendState(d) { send({ t: 's', d }); },
    sendInput(d) { send({ t: 'i', d }); },
    // Host: yeni mac (kural/gorunum degismis olabilir -> misafire de gider)
    rematch(d) { if (d) look = { rules: d.rules, skin: d.skin, puck: d.puck }; send({ t: 'rm', d }); },
    rematchRequest() { send({ t: 'rq' }); },      // "rovansa hazirim" (iki yonde)
    // Bilerek cikis: durum HEMEN sifirlanir, kanal 'bye' gitsin diye biraz sonra
    // kapanir. (Once kanal acik birakilip 100ms sonra sifirlaniyordu: rakip o
    // arada kapatinca bu sayfa kopma sanip sahipsiz geri sayim baslatiyordu.)
    leave() {
      send({ t: 'bye' });
      const p = peer, c = conn;
      peer = conn = null;
      teardown();
      setTimeout(() => {
        if (c) { try { c.close(); } catch (e) {} }
        if (p) { try { p.destroy(); } catch (e) {} }
      }, 150);
    }
  };
})();
