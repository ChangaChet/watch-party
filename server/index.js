import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? true
      : ["http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? true
    : ["http://localhost:5173", "http://localhost:3000"],
  credentials: true
}));
app.use(express.json());

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

// Video proxy endpoint - bypasses CORS & Remuxes MKV to MP4
app.get('/api/proxy-video', async (req, res) => {
  const videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Check if we need to remux (MKV files)
  const isMkv = videoUrl.toLowerCase().includes('.mkv');

  try {
    if (isMkv) {
      console.log('Remuxing MKV stream via FFmpeg (Direct):', videoUrl);

      const ffmpeg = (await import('fluent-ffmpeg')).default;

      // Set headers for MP4 stream
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Content-Type', 'video/mp4');

      // Spawn FFmpeg - Direct URL input (proven to work in tests)
      // Use COPY for speed, but fallback to transcode if needed
      const command = ffmpeg(videoUrl)
        .inputOptions([
          '-headers', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5'
        ])
        .outputOptions([
          '-c:v copy', // Fast copy (remux)
          '-c:a aac',  // Audio to AAC for safety
          '-movflags frag_keyframe+empty_moov+default_base_moof', // Browser streaming flags
          '-f mp4'
        ])
        .on('start', (cmdLine) => console.log('FFmpeg started:', cmdLine))
        .on('error', (err) => {
          if (!err.message.includes('Output stream closed')) {
            console.error('FFmpeg error:', err.message);
          }
          if (!res.headersSent) res.status(500).end();
        })
        .pipe(res, { end: true });

      req.on('close', () => {
        try { command.kill(); } catch (e) { }
      });

    } else {
      // Standard Proxy logic for non-MKV
      const fetch = (await import('node-fetch')).default;

      const response = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Range': req.headers.range || '',
          'Referer': new URL(videoUrl).origin
        }
      });

      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Range');
      res.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

      res.status(response.status);
      if (response.headers.get('content-type')) res.set('Content-Type', response.headers.get('content-type'));
      if (response.headers.get('content-length')) res.set('Content-Length', response.headers.get('content-length'));
      if (response.headers.get('content-range')) res.set('Content-Range', response.headers.get('content-range'));
      if (response.headers.get('accept-ranges')) res.set('Accept-Ranges', response.headers.get('accept-ranges'));

      response.body.pipe(res);
    }
  } catch (error) {
    console.error('Proxy error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch video', details: error.message });
    }
  }
});

app.options('/api/proxy-video', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Range');
  res.status(204).send();
});

if (process.env.NODE_ENV === 'production') {
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

// Socket Logic
const rooms = new Map();
io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, username }) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        playlist: [], currentIndex: 0, isPlaying: false, currentTime: 0,
        users: [], messages: [], adminId: socket.id, permissions: 'open'
      });
    }
    const room = rooms.get(roomId);
    room.users.push({ id: socket.id, username });
    socket.emit('room_state', room);
    socket.to(roomId).emit('user_joined', { username, userCount: room.users.length, users: room.users });
    if (room.users.length > 1) {
      const existingUser = room.users.find(u => u.id !== socket.id);
      if (existingUser) io.to(existingUser.id).emit('request_sync', { requesterId: socket.id });
    }
  });

  socket.on('add_to_playlist', ({ roomId, videoUrl }) => {
    const room = rooms.get(roomId);
    if (room && (room.permissions === 'open' || room.adminId === socket.id)) {
      room.playlist.push(videoUrl);
      io.to(roomId).emit('playlist_updated', { playlist: room.playlist });
    }
  });

  socket.on('remove_from_playlist', ({ roomId, index }) => {
    const room = rooms.get(roomId);
    if (room && index >= 0 && index < room.playlist.length && (room.permissions === 'open' || room.adminId === socket.id)) {
      room.playlist.splice(index, 1);
      if (room.currentIndex >= room.playlist.length && room.playlist.length > 0) room.currentIndex = room.playlist.length - 1;
      io.to(roomId).emit('playlist_updated', { playlist: room.playlist, currentIndex: room.currentIndex });
    }
  });

  socket.on('change_video', ({ roomId, index }) => {
    const room = rooms.get(roomId);
    if (room && index >= 0 && index < room.playlist.length && (room.permissions === 'open' || room.adminId === socket.id)) {
      room.currentIndex = index; room.currentTime = 0; room.isPlaying = true;
      io.to(roomId).emit('video_changed', { currentIndex: index, currentTime: 0, isPlaying: true });
    }
  });

  socket.on('sync_action', ({ roomId, action, data }) => {
    const room = rooms.get(roomId);
    if (!room || (room.permissions === 'restricted' && room.adminId !== socket.id)) return;
    if (data.currentTime !== undefined) room.currentTime = data.currentTime;
    switch (action) {
      case 'play': room.isPlaying = true; socket.to(roomId).emit('sync_play', { currentTime: data.currentTime }); break;
      case 'pause': room.isPlaying = false; socket.to(roomId).emit('sync_pause', { currentTime: data.currentTime }); break;
      case 'seek': if (data.isPlaying !== undefined) room.isPlaying = data.isPlaying; socket.to(roomId).emit('sync_seek', { currentTime: data.currentTime, isPlaying: data.isPlaying }); break;
    }
  });

  socket.on('sync_response', ({ requesterId, currentTime, isPlaying }) => io.to(requesterId).emit('sync_seek', { currentTime, isPlaying }));
  socket.on('ask_for_time', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.users.length > 1) {
      const existingUser = room.users.find(u => u.id !== socket.id);
      if (existingUser) io.to(existingUser.id).emit('request_sync', { requesterId: socket.id });
    }
  });

  socket.on('offer', p => io.to(p.target).emit('offer', p));
  socket.on('answer', p => io.to(p.target).emit('answer', p));
  socket.on('ice-candidate', p => io.to(p.target).emit('ice-candidate', p));
  socket.on('toggle_mute', ({ roomId, isMuted }) => socket.to(roomId).emit('user_muted', { userId: socket.id, isMuted }));
  socket.on('speaking_status', ({ roomId, isSpeaking }) => socket.to(roomId).emit('user_speaking', { userId: socket.id, isSpeaking }));
  socket.on('send_message', ({ roomId, message, username }) => {
    const room = rooms.get(roomId);
    if (room) {
      const chatMessage = { id: Date.now(), username, message, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
      room.messages.push(chatMessage);
      io.to(roomId).emit('chat_message', chatMessage);
    }
  });
  socket.on('toggle_permissions', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.adminId === socket.id) {
      room.permissions = room.permissions === 'open' ? 'restricted' : 'open';
      io.to(roomId).emit('permissions_updated', { permissions: room.permissions });
    }
  });
  socket.on('send_reaction', ({ roomId, emoji }) => io.to(roomId).emit('reaction_received', { emoji, userId: socket.id }));
  socket.on('kick_user', ({ roomId, targetId }) => {
    const room = rooms.get(roomId);
    if (room && room.adminId === socket.id) {
      io.to(targetId).emit('kicked');
      const userIndex = room.users.findIndex(u => u.id === targetId);
      if (userIndex !== -1) {
        const kickedUser = room.users[userIndex];
        room.users.splice(userIndex, 1);
        io.to(roomId).emit('user_left', { username: kickedUser.username, users: room.users });
        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) targetSocket.leave(roomId);
      }
    }
  });
  socket.on('disconnect', () => {
    rooms.forEach((room, roomId) => {
      const userIndex = room.users.findIndex(u => u.id === socket.id);
      if (userIndex !== -1) {
        const username = room.users[userIndex].username;
        room.users.splice(userIndex, 1);
        if (room.adminId === socket.id && room.users.length > 0) {
          room.adminId = room.users[0].id;
          io.to(roomId).emit('admin_updated', { adminId: room.adminId });
        }
        io.to(roomId).emit('user_left', { username, userCount: room.users.length, users: room.users });
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
