const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const MAX_USERS = 3; // fixed room capacity — 3 users max
const ROOM = 'main-room';

// Fixed set of allowed users — only these 3 accounts can join
const VALID_USERS = {
  'manish': 'manish@7355',
  'razan': 'razan@7355',
  'aaditya': 'aaditya@7355'
};

app.use(express.static(path.join(__dirname, 'public')));

// track connected users: socket.id -> { name }
const users = {};
// track which usernames are currently connected (to block duplicate logins)
const loggedInUsernames = new Set();

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('join', ({ username, password } = {}) => {
    const cleanUsername = (username || '').trim().toLowerCase();

    if (!VALID_USERS[cleanUsername] || VALID_USERS[cleanUsername] !== password) {
      socket.emit('auth-error', 'Invalid username or password.');
      return;
    }

    if (loggedInUsernames.has(cleanUsername)) {
      socket.emit('auth-error', 'This user is already connected elsewhere.');
      return;
    }

    const roomSize = io.sockets.adapter.rooms.get(ROOM)?.size || 0;
    if (roomSize >= MAX_USERS) {
      socket.emit('room-full');
      return;
    }

    users[socket.id] = { name: cleanUsername };
    loggedInUsernames.add(cleanUsername);
    socket.join(ROOM);

    // tell the new user about everyone already in the room
    const existingUsers = Array.from(io.sockets.adapter.rooms.get(ROOM) || [])
      .filter((id) => id !== socket.id)
      .map((id) => ({ id, name: users[id]?.name }));

    socket.emit('joined', { id: socket.id, existingUsers });

    // tell everyone else a new user arrived
    socket.to(ROOM).emit('user-joined', { id: socket.id, name: users[socket.id].name });
  });

  // WebRTC signaling relay — sent peer-to-peer via the server
  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // chat messages broadcast to the room
  socket.on('chat-message', (text) => {
    const name = users[socket.id]?.name || 'Anonymous';
    io.to(ROOM).emit('chat-message', { from: socket.id, name, text, ts: Date.now() });
  });

  socket.on('disconnect', () => {
    console.log('disconnected:', socket.id);
    socket.to(ROOM).emit('user-left', { id: socket.id });
    if (users[socket.id]) {
      loggedInUsernames.delete(users[socket.id].name);
    }
    delete users[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));