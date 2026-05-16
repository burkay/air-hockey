// Socket.IO istemci sarmalayici.
// Olay aboneligini ve mesaj gondermeyi tek yerde toplar.

const Net = (() => {
  const socket = io({ reconnection: true });
  const handlers = {};

  socket.onAny((event, payload) => {
    if (handlers[event]) handlers[event].forEach((fn) => fn(payload));
  });

  return {
    socket,
    on(event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
    },
    createRoom(password, rules) {
      socket.emit('create_room', { password, rules });
    },
    joinRoom(password) {
      socket.emit('join_room', { password });
    },
    resume(password, role) {
      socket.emit('resume_room', { password, role });
    },
    sendState(data) {
      socket.emit('state', data);
    },
    sendInput(data) {
      socket.emit('input', data);
    },
    rematch() {
      socket.emit('rematch');
    },
    rematchRequest() {
      socket.emit('rematch_request');
    },
    leave() {
      socket.emit('leave_room');
    }
  };
})();
