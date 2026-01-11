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

// Serve static files from the React app in production
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
      console.log('Starting FFmpeg transcoding for:', videoUrl);

      // Dynamic import
      const ffmpeg = (await import('fluent-ffmpeg')).default;
      const fetch = (await import('node-fetch')).default;

      // Fetch the source stream first (avoids FFmpeg HTTPS/protocol issues)
      const sourceResponse = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          // Removed Referer to avoid potential blocking
        }
      });

      if (!sourceResponse.ok) {
        const errText = await sourceResponse.text();
        throw new Error(`Source fetch failed: ${sourceResponse.status} ${sourceResponse.statusText} - ${errText.substring(0, 100)}`);
      }

      const contentType = sourceResponse.headers.get('content-type');
      console.log(`Upstream Content-Type: ${contentType}`);

      // Set headers for MP4 stream
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Content-Type', 'video/mp4');

      // Spawn FFmpeg to remux/transcode to fragmented MP4
      const command = ffmpeg(sourceResponse.body)
        .inputFormat('matroska') // Explicitly tell FFmpeg this is MKV/Matroska stream
        .outputOptions([
          '-c:v libx264',
          '-preset ultrafast',
          '-tune zerolatency',
          '-c:a aac',
          '-movflags frag_keyframe+empty_moov+default_base_moof',
          '-f mp4'
        ])
        .on('start', (cmdLine) => console.log('FFmpeg started:', cmdLine))
        .on('codecData', (data) => console.log('FFmpeg codec data:', data))
        .on('error', (err) => {
          console.error('FFmpeg error:', err.message);
          // Only attempt to send error header if not already sent
          if (!res.headersSent) {
            res.status(500).end();
          }
        })
        .pipe(res, { end: true });

      req.on('close', () => {
        try { command.kill(); } catch (e) { }
      });

    } else {
      // Standard Proxy for MP4/WebM
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
      // Return 500 but also try to give detailed JSON error
      res.status(500).json({ error: 'Failed to fetch video', details: error.message });
    }
  }
});

// Handle OPTIONS for CORS preflight
app.options('/api/proxy-video', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Range');
  res.status(204).send();
});

// Handle React routing in production (must be after API routes)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

// Room state management
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a room
  socket.on('join_room', ({ roomId, username }) => {
    socket.join(roomId);

    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        playlist: [],
        currentIndex: 0,
        isPlaying: false,
        currentTime: 0,
        users: [],
        messages: [],
        adminId: socket.id,
        permissions: 'open'
      });
    }

    const room = rooms.get(roomId);
    room.users.push({ id: socket.id, username });

    // Send current room state to the new user
    socket.emit('room_state', room);

    // Notify others in the room with updated user list
    socket.to(roomId).emit('user_joined', {
      username,
      userCount: room.users.length,
      users: room.users
    });

    // Request sync from existing users to ensure new user gets exact time
    if (room.users.length > 1) {
      const existingUser = room.users.find(u => u.id !== socket.id);
      if (existingUser) {
        io.to(existingUser.id).emit('request_sync', { requesterId: socket.id });
      }
    }

    console.log(`${username} joined room ${roomId}`);
  });

  // Add video to playlist
  socket.on('add_to_playlist', ({ roomId, videoUrl }) => {
    const room = rooms.get(roomId);
    if (room) {
      if (room.permissions === 'restricted' && room.adminId !== socket.id) return;
      room.playlist.push(videoUrl);
      io.to(roomId).emit('playlist_updated', { playlist: room.playlist });
      console.log(`Video added to room ${roomId}:`, videoUrl);
    }
  });

  // Remove video from playlist
  socket.on('remove_from_playlist', ({ roomId, index }) => {
    const room = rooms.get(roomId);
    if (room && index >= 0 && index < room.playlist.length) {
      if (room.permissions === 'restricted' && room.adminId !== socket.id) return;
      room.playlist.splice(index, 1);
      // Adjust currentIndex if needed
      if (room.currentIndex >= room.playlist.length && room.playlist.length > 0) {
        room.currentIndex = room.playlist.length - 1;
      }
      io.to(roomId).emit('playlist_updated', {
        playlist: room.playlist,
        currentIndex: room.currentIndex
      });
    }
  });

  // Change video
  socket.on('change_video', ({ roomId, index }) => {
    const room = rooms.get(roomId);
    if (room && index >= 0 && index < room.playlist.length) {
      if (room.permissions === 'restricted' && room.adminId !== socket.id) return;
      room.currentIndex = index;
      room.currentTime = 0;
      room.isPlaying = true;
      io.to(roomId).emit('video_changed', {
        currentIndex: index,
        currentTime: 0,
        isPlaying: true
      });
      console.log(`Room ${roomId} changed to video ${index}`);
    }
  });

  // Sync playback actions
  socket.on('sync_action', ({ roomId, action, data }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.permissions === 'restricted' && room.adminId !== socket.id) return;

    // Always update current time
    if (data.currentTime !== undefined) {
      room.currentTime = data.currentTime;
    }

    switch (action) {
      case 'play':
        room.isPlaying = true;
        socket.to(roomId).emit('sync_play', { currentTime: data.currentTime });
        break;
      case 'pause':
        room.isPlaying = false;
        socket.to(roomId).emit('sync_pause', { currentTime: data.currentTime });
        break;
      case 'seek':
        if (data.isPlaying !== undefined) {
          room.isPlaying = data.isPlaying;
        }
        socket.to(roomId).emit('sync_seek', { currentTime: data.currentTime, isPlaying: data.isPlaying });
        break;
    }
  });

  // Handle sync response from existing user
  socket.on('sync_response', ({ requesterId, currentTime, isPlaying }) => {
    io.to(requesterId).emit('sync_seek', { currentTime, isPlaying });
  });

  // Handle explicit time request from new user (when player is ready)
  socket.on('ask_for_time', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.users.length > 1) {
      const existingUser = room.users.find(u => u.id !== socket.id);
      if (existingUser) {
        io.to(existingUser.id).emit('request_sync', { requesterId: socket.id });
      }
    }
  });

  // WebRTC Signaling
  socket.on('offer', payload => {
    io.to(payload.target).emit('offer', payload);
  });

  socket.on('answer', payload => {
    io.to(payload.target).emit('answer', payload);
  });

  socket.on('ice-candidate', payload => {
    io.to(payload.target).emit('ice-candidate', payload);
  });

  // Handle mute toggle
  socket.on('toggle_mute', ({ roomId, isMuted }) => {
    socket.to(roomId).emit('user_muted', { userId: socket.id, isMuted });
  });

  // Handle speaking status
  socket.on('speaking_status', ({ roomId, isSpeaking }) => {
    socket.to(roomId).emit('user_speaking', { userId: socket.id, isSpeaking });
  });

  // Handle chat messages
  socket.on('send_message', ({ roomId, message, username }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const chatMessage = {
      id: Date.now(),
      username,
      message,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    // Store message in room
    room.messages.push(chatMessage);

    // Broadcast to all users in room (including sender)
    io.to(roomId).emit('chat_message', chatMessage);
  });

  // Admin: Toggle Permissions
  socket.on('toggle_permissions', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.adminId === socket.id) {
      room.permissions = room.permissions === 'open' ? 'restricted' : 'open';
      io.to(roomId).emit('permissions_updated', { permissions: room.permissions });
    }
  });

  // Live Reaction
  socket.on('send_reaction', ({ roomId, emoji }) => {
    io.to(roomId).emit('reaction_received', { emoji, userId: socket.id });
  });

  // Kick User
  socket.on('kick_user', ({ roomId, targetId }) => {
    const room = rooms.get(roomId);
    if (room && room.adminId === socket.id) {
      io.to(targetId).emit('kicked');

      const userIndex = room.users.findIndex(u => u.id === targetId);
      if (userIndex !== -1) {
        const kickedUser = room.users[userIndex];
        room.users.splice(userIndex, 1);
        io.to(roomId).emit('user_left', {
          username: kickedUser.username,
          users: room.users
        });

        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
          targetSocket.leave(roomId);
        }
      }
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Remove user from all rooms
    rooms.forEach((room, roomId) => {
      const userIndex = room.users.findIndex(u => u.id === socket.id);
      if (userIndex !== -1) {
        const username = room.users[userIndex].username;
        room.users.splice(userIndex, 1);

        // Handle Admin Reassignment
        if (room.adminId === socket.id) {
          if (room.users.length > 0) {
            room.adminId = room.users[0].id;
            io.to(roomId).emit('admin_updated', { adminId: room.adminId });
          }
        }

        io.to(roomId).emit('user_left', {
          username,
          userCount: room.users.length,
          users: room.users
        });
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
