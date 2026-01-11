import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

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

// Low-level FFmpeg Proxy using spawn for maximum control
app.get('/api/proxy-video', async (req, res) => {
  const videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const isMkv = videoUrl.toLowerCase().includes('.mkv');

  try {
    if (isMkv) {
      console.log('Spawning FFmpeg (Direct Pipe) for:', videoUrl);
      const fetch = (await import('node-fetch')).default;

      // 1. Fetch the source stream (follow redirects)
      const sourceResponse = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
          'Referer': 'https://real-debrid.com/'
        }
      });

      if (!sourceResponse.ok) {
        throw new Error(`Source fetch failed: ${sourceResponse.status} ${sourceResponse.statusText}`);
      }

      console.log('Source Content-Type:', sourceResponse.headers.get('content-type'));
      console.log('Final URL:', sourceResponse.url);

      // 2. Set Response Headers
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'video/mp4',
        'Connection': 'keep-alive'
      });

      // 3. Spawn FFmpeg Process
      const ffmpegArgs = [
        '-i', 'pipe:0', // Input from Stdin
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-profile:v', 'main',
        '-pix_fmt', 'yuv420p', // Force 8-bit color output (Fixes black screen/compatibility)
        '-c:a', 'aac',
        '-ar', '44100',
        '-ac', '2',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4',
        'pipe:1' // Output to Stdout
      ];

      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

      // 4. Pipe Fetch Body -> FFmpeg Stdin
      sourceResponse.body.pipe(ffmpegProcess.stdin);

      // 5. Pipe FFmpeg Stdout -> Response
      ffmpegProcess.stdout.pipe(res);

      // 6. Error Handling & logging
      ffmpegProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        // Console log mostly errors or startup
        if (msg.includes('Error') || msg.includes('Invalid') || msg.includes('Stream #')) {
          console.log('FFmpeg:', msg.substring(0, 200));
        }
      });

      ffmpegProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        if (!res.writableEnded) res.end();
      });

      // Handle Client Disconnect
      req.on('close', () => {
        console.log('Client disconnected, killing FFmpeg');
        ffmpegProcess.kill();
        sourceResponse.body.unpipe(); // Stop fetching
      });

    } else {
      // Standard Proxy for non-MKV
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(videoUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 ...' }
      });
      res.writeHead(response.status, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': response.headers.get('content-type') || 'video/mp4'
      });
      response.body.pipe(res);
    }

  } catch (error) {
    console.error('Proxy Fatal Error:', error.message);
    if (!res.headersSent) {
      // Fallback: Redirect to original URL so browser attempts direct playback
      // This mitigates the IP Blocking issue on Render by letting the user's browser take over
      return res.redirect(videoUrl);
    }
  }
});

app.options('/api/proxy-video', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.status(204).send();
});

// Socket Logic ...
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
        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) targetSocket.leave(roomId);
      }
    }
  });
  // Missing handlers added back
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
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
