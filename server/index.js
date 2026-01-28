import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// Allow all origins
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({ origin: "*" }));
app.use(express.json());

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

// ---------------------------------------------------------
// SERVER V10 - LIGHTWEIGHT (NO FFMPEG)
// ---------------------------------------------------------

// NOTE: All video playback is now handled on the client-side via EmbedPlayer (MappleTV).
// The server only handles WebSocket syncing and simple IMDB lookups.

// ---------------------------------------------------------
// REST OF APP (IMDB, Sockets)
// ---------------------------------------------------------

app.get('/api/imdb-search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ d: [] });
  const firstChar = query[0].toLowerCase();
  const url = `https://v2.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(query)}.json`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await response.json();
    res.json(data);
  } catch (e) { res.json({ d: [] }); }
});

const rooms = new Map();
io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, username }) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { playlist: [], currentIndex: 0, isPlaying: false, currentTime: 0, users: [], messages: [], adminId: socket.id, permissions: 'open' });
    }
    const room = rooms.get(roomId);
    room.users.push({ id: socket.id, username });
    socket.emit('room_state', room);
    socket.to(roomId).emit('user_joined', { username, userCount: room.users.length, users: room.users });
  });

  socket.on('add_to_playlist', ({ roomId, videoUrl }) => {
    const room = rooms.get(roomId);
    if (room) { room.playlist.push(videoUrl); io.to(roomId).emit('playlist_updated', { playlist: room.playlist }); }
  });
  socket.on('change_video', ({ roomId, index }) => {
    const room = rooms.get(roomId);
    if (room) { room.currentIndex = index; room.isPlaying = true; io.to(roomId).emit('video_changed', { currentIndex: index, currentTime: 0, isPlaying: true }); }
  });
  socket.on('sync_action', ({ roomId, action, data }) => {
    const room = rooms.get(roomId);
    if (room) {
      if (data.currentTime) room.currentTime = data.currentTime;
      if (action === 'play') room.isPlaying = true;
      if (action === 'pause') room.isPlaying = false;
      socket.to(roomId).emit(`sync_${action}`, data);
    }
  });
  socket.on('sync_response', ({ requesterId, currentTime, isPlaying }) => io.to(requesterId).emit('sync_seek', { currentTime, isPlaying }));
  socket.on('ask_for_time', ({ roomId }) => {
    const room = rooms.get(roomId);
    const user = room?.users.find(u => u.id !== socket.id);
    if (user) io.to(user.id).emit('request_sync', { requesterId: socket.id });
  });
  socket.on('offer', p => io.to(p.target).emit('offer', p));
  socket.on('answer', p => io.to(p.target).emit('answer', p));
  socket.on('ice-candidate', p => io.to(p.target).emit('ice-candidate', p));
  socket.on('send_message', ({ roomId, message, username }) => {
    const room = rooms.get(roomId);
    if (room) {
      const msg = { id: Date.now(), username, message, timestamp: new Date().toLocaleTimeString() };
      room.messages.push(msg);
      io.to(roomId).emit('chat_message', msg);
    }
  });
  socket.on('disconnect', () => {
    rooms.forEach((room, roomId) => {
      const idx = room.users.findIndex(u => u.id === socket.id);
      if (idx !== -1) {
        room.users.splice(idx, 1);
        io.to(roomId).emit('user_left', { users: room.users });
      }
    });
  });
  socket.on('kick_user', ({ roomId, targetId }) => {
    const room = rooms.get(roomId);
    if (room && room.adminId === socket.id) {
      io.to(targetId).emit('kicked');
      const userIndex = room.users.findIndex(u => u.id === targetId);
      if (userIndex !== -1) {
        const kickedUser = room.users[userIndex];
        room.users.splice(userIndex, 1);
        io.to(roomId).emit('user_left', { username: kickedUser.username, users: room.users });
      }
    }
  });
  socket.on('remove_from_playlist', ({ roomId, index }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.playlist.splice(index, 1);
      io.to(roomId).emit('playlist_updated', { playlist: room.playlist });
    }
  });
  socket.on('toggle_mute', ({ roomId, isMuted }) => socket.to(roomId).emit('user_muted', { userId: socket.id, isMuted }));
  socket.on('speaking_status', ({ roomId, isSpeaking }) => socket.to(roomId).emit('user_speaking', { userId: socket.id, isSpeaking }));
  socket.on('toggle_permissions', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.adminId === socket.id) { room.permissions = room.permissions === 'open' ? 'restricted' : 'open'; io.to(roomId).emit('permissions_updated', { permissions: room.permissions }); }
  });
  socket.on('send_reaction', ({ roomId, emoji }) => io.to(roomId).emit('reaction_received', { emoji, userId: socket.id }));
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log('///////////////////////////////////////////////////////////');
  console.log('🚀 SERVER STARTED - VERSION 9.0 (PIPE CHAIN METHOD)');
  console.log(`🚀 Listening on port ${PORT}`);
  console.log('///////////////////////////////////////////////////////////');
});