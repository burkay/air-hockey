// Air Hockey sunucusu
// Gorevi: statik dosyalari servis etmek + Socket.IO ile sifre bazli oda
// eslestirme ve mesaj roleleme. Fizik calistirmaz (host-authoritative model).

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Mobil aglarda kopmalara karsi toleransli ayarlar
  pingInterval: 10000,
  pingTimeout: 20000
});

app.use(express.static(path.join(__dirname, 'public')));

// Basit saglik kontrolu (bulut platformlari icin)
app.get('/healthz', (_req, res) => res.send('ok'));

// rooms: password -> { hostId, guestId, rules }
const rooms = new Map();

const VALID_RULES = new Set(['first7', 'first11', 'timed']);
const VALID_SKINS = new Set(['neon', 'arcade']);
const VALID_PUCK = new Set(['small', 'med', 'large']);

function normalizePassword(p) {
  return (typeof p === 'string' ? p : '').trim();
}

io.on('connection', (socket) => {
  // socket.data: { room, role }

  socket.on('create_room', (payload = {}) => {
    const password = normalizePassword(payload.password);
    const rules = VALID_RULES.has(payload.rules) ? payload.rules : 'first7';
    const skin = VALID_SKINS.has(payload.skin) ? payload.skin : 'neon';
    const puck = VALID_PUCK.has(payload.puck) ? payload.puck : 'med';

    if (!password) {
      socket.emit('error_msg', { code: 'bad_password', message: 'Lutfen bir sifre gir.' });
      return;
    }

    const existing = rooms.get(password);
    if (existing && io.sockets.sockets.get(existing.hostId)) {
      socket.emit('error_msg', {
        code: 'password_taken',
        message: 'Bu sifre kullanimda, baska bir sifre sec.'
      });
      return;
    }

    const room = { hostId: socket.id, guestId: null, rules, skin, puck };
    rooms.set(password, room);
    socket.join(password);
    socket.data = { room: password, role: 'host' };

    socket.emit('room_created', { password, rules, skin, puck });
  });

  socket.on('join_room', (payload = {}) => {
    const password = normalizePassword(payload.password);
    const room = rooms.get(password);

    if (!room || !io.sockets.sockets.get(room.hostId)) {
      socket.emit('error_msg', {
        code: 'no_room',
        message: 'Bu sifreyle acik bir oyun yok.'
      });
      return;
    }
    if (room.guestId && io.sockets.sockets.get(room.guestId)) {
      socket.emit('error_msg', { code: 'room_full', message: 'Bu oyun dolu.' });
      return;
    }

    room.guestId = socket.id;
    socket.join(password);
    socket.data = { room: password, role: 'guest' };

    socket.emit('joined', { rules: room.rules, skin: room.skin, puck: room.puck });
    io.to(room.hostId).emit('peer_joined');
  });

  // Host -> misafir: yetkili oyun durumu
  socket.on('state', (data) => {
    const p = socket.data && socket.data.room;
    if (p) socket.to(p).emit('state', data);
  });

  // Misafir -> host: paddle girdisi
  socket.on('input', (data) => {
    const p = socket.data && socket.data.room;
    if (p) socket.to(p).emit('input', data);
  });

  // Misafir host'tan yeni mac ister
  socket.on('rematch_request', () => {
    const p = socket.data && socket.data.room;
    if (p) socket.to(p).emit('rematch_request');
  });

  // Host yeni maci baslatti -> misafir oyun ekranina donsun
  socket.on('rematch', () => {
    const p = socket.data && socket.data.room;
    if (p) socket.to(p).emit('rematch');
  });

  // Yeniden baglanma: kopan istemci yeni socket ile eski yerini geri alir.
  // Boylece kisa mobil kopmalar maci kalici bozmaz (skor/oyun korunur).
  socket.on('resume_room', (payload = {}) => {
    const password = normalizePassword(payload.password);
    const role = payload.role === 'host' ? 'host'
               : payload.role === 'guest' ? 'guest' : null;
    const room = rooms.get(password);
    if (!room || !role) {
      socket.emit('peer_left', { who: 'host' });   // oda kapanmis -> lobiye
      return;
    }
    if (role === 'host') room.hostId = socket.id;
    else room.guestId = socket.id;
    socket.join(password);
    socket.data = { room: password, role };
    if (room.grace && room.grace[role]) {
      clearTimeout(room.grace[role]);
      room.grace[role] = null;
    }
    const peerId = role === 'host' ? room.guestId : room.hostId;
    if (peerId) io.to(peerId).emit('peer_back', { who: role });
    socket.emit('resumed');
  });

  socket.on('leave_room', () => cleanupNow(socket));   // bilerek cikis: aninda
  socket.on('disconnect', () => scheduleCleanup(socket)); // kopma: toleransli

  // Kopmada hemen kapatma: peer'a "bekleniyor" de, ~25sn grace ver.
  function scheduleCleanup(sock) {
    const password = sock.data && sock.data.room;
    if (!password) return;
    const room = rooms.get(password);
    if (!room) return;
    let role = null;
    if (room.hostId === sock.id) role = 'host';
    else if (room.guestId === sock.id) role = 'guest';
    if (!role) return;

    const peerId = role === 'host' ? room.guestId : room.hostId;
    if (peerId) io.to(peerId).emit('peer_dropped', { who: role });

    room.grace = room.grace || {};
    if (room.grace[role]) clearTimeout(room.grace[role]);
    const deadId = sock.id;
    room.grace[role] = setTimeout(() => realCleanup(password, role, deadId), 25000);
    sock.data = {};
  }

  // Grace dolunca (ve yer geri alinmadiysa) gercek kapatma.
  function realCleanup(password, role, deadId) {
    const room = rooms.get(password);
    if (!room) return;
    if (role === 'host' && room.hostId !== deadId) return;   // geri alinmis
    if (role === 'guest' && room.guestId !== deadId) return;  // geri alinmis
    if (role === 'host') {
      if (room.guestId) io.to(room.guestId).emit('peer_left', { who: 'host' });
      if (room.grace) {
        clearTimeout(room.grace.host); clearTimeout(room.grace.guest);
      }
      rooms.delete(password);
    } else {
      room.guestId = null;
      if (room.hostId) io.to(room.hostId).emit('peer_left', { who: 'guest' });
    }
  }

  // Bilerek cikista aninda kapat (grace yok).
  function cleanupNow(sock) {
    const password = sock.data && sock.data.room;
    if (!password) return;
    const room = rooms.get(password);
    if (room) {
      if (room.hostId === sock.id) {
        if (room.guestId) io.to(room.guestId).emit('peer_left', { who: 'host' });
        if (room.grace) {
          clearTimeout(room.grace.host); clearTimeout(room.grace.guest);
        }
        rooms.delete(password);
      } else if (room.guestId === sock.id) {
        room.guestId = null;
        if (room.hostId) io.to(room.hostId).emit('peer_left', { who: 'guest' });
      }
    }
    sock.data = {};
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Air Hockey calisiyor: http://localhost:${PORT}`);
});
