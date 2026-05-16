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

function normalizePassword(p) {
  return (typeof p === 'string' ? p : '').trim();
}

io.on('connection', (socket) => {
  // socket.data: { room, role }

  socket.on('create_room', (payload = {}) => {
    const password = normalizePassword(payload.password);
    const rules = VALID_RULES.has(payload.rules) ? payload.rules : 'first7';

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

    const room = { hostId: socket.id, guestId: null, rules };
    rooms.set(password, room);
    socket.join(password);
    socket.data = { room: password, role: 'host' };

    socket.emit('room_created', { password, rules });
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

    socket.emit('joined', { rules: room.rules });
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

  socket.on('leave_room', () => {
    cleanup(socket);
  });

  socket.on('disconnect', () => {
    cleanup(socket);
  });

  function cleanup(sock) {
    const password = sock.data && sock.data.room;
    if (!password) return;
    const room = rooms.get(password);
    if (!room) return;

    if (room.hostId === sock.id) {
      // Host gitti: oda kapanir, misafir bilgilendirilir
      if (room.guestId) io.to(room.guestId).emit('peer_left', { who: 'host' });
      rooms.delete(password);
    } else if (room.guestId === sock.id) {
      // Misafir gitti: oda durur, host bekleme ekranina doner,
      // ayni sifreyle yeni misafir katilabilir
      room.guestId = null;
      if (room.hostId) io.to(room.hostId).emit('peer_left', { who: 'guest' });
    }
    sock.data = {};
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Air Hockey calisiyor: http://localhost:${PORT}`);
});
