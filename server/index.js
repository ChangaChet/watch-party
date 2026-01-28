import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import ffmpegPath from 'ffmpeg-static';

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
// PROXY VIDEO HANDLER (VERSION 9.0 - PIPE CHAIN METHOD)
// ---------------------------------------------------------
app.get('/api/proxy-video', async (req, res) => {
  const videoUrl = req.query.url;
  const RD_TOKEN = 'CPRGHLAYDFGU5TZ4DCYQQQPRRFGZ22FIAIS7OQKK23VE45RWQ5SQ';

  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Helper: Pipe a direct URL (Zero CPU usage)
  const pipeRequest = async (sourceUrl) => {
    try {
      console.log('🔗 Proxying Direct Link:', sourceUrl);
      const response = await fetch(sourceUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (!response.ok) throw new Error(`Stream failed: ${response.status}`);

      res.writeHead(response.status, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': response.headers.get('content-type') || 'video/mp4',
        'Content-Length': response.headers.get('content-length'),
      });
      response.body.pipe(res);
      return true;
    } catch (e) {
      console.error('❌ Pipe Error:', e.message);
      return false;
    }
  };

  try {
    let finalLink = videoUrl;

    // --- STRATEGY 1: TORRENTIO "HASH HUNTING" ---
    const match = videoUrl.match(/realdebrid\/[A-Za-z0-9]+\/([a-zA-Z0-9]+)/);

    if (match && match[1]) {
      const hash = match[1];
      console.log(`🕵️ Torrentio Detected! Hash: ${hash}`);
      console.log('⚡ Hunting for MP4 via RD API...');

      try {
        // 1. Get Torrent ID
        const magParams = new URLSearchParams();
        magParams.append('magnet', `magnet:?xt=urn:btih:${hash}`);

        const addRes = await fetch('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RD_TOKEN}` },
          body: magParams
        });
        const addData = await addRes.json();

        if (addData.id) {
          // 2. Activate Files
          await fetch(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addData.id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RD_TOKEN}` },
            body: new URLSearchParams({ files: 'all' })
          });

          // 3. Get Link Info
          const infoRes = await fetch(`https://api.real-debrid.com/rest/1.0/torrents/info/${addData.id}`, {
            headers: { 'Authorization': `Bearer ${RD_TOKEN}` }
          });
          const infoData = await infoRes.json();

          if (infoData.links && infoData.links.length > 0) {
            // 4. Unrestrict the first link
            const unrestrictParams = new URLSearchParams();
            unrestrictParams.append('link', infoData.links[0]);

            const unRes = await fetch('https://api.real-debrid.com/rest/1.0/unrestrict/link', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${RD_TOKEN}` },
              body: unrestrictParams
            });
            const unData = await unRes.json();

            // 5. Look for Pre-Made MP4
            if (unData.alternative && unData.alternative.length > 0) {
              const mp4Alt = unData.alternative.find(alt => alt.quality === '1080p') ||
                unData.alternative.find(alt => alt.quality === '720p') ||
                unData.alternative[0];

              if (mp4Alt && mp4Alt.download) {
                console.log('🎉 SUCCESS: Found Streamable MP4:', mp4Alt.download);
                return await pipeRequest(mp4Alt.download);
              }
            }

            if (unData.download) {
              console.log('⚠️ No MP4 alternative found. Using direct MKV link from API.');
              finalLink = unData.download;
            }
          }
        }
      } catch (e) {
        console.error('⚠️ Hash Hunt Error:', e.message);
      }
    }

    // --- STRATEGY 2: PIPE-CHAIN TRANSCODING (VERSION 9.0) ---
    console.log('📥 Establishing Source Connection...');

    // Step A: Fetch the file stream using Node.js (Reliable)
    const upstreamRes = await fetch(finalLink, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!upstreamRes.ok) {
      console.error(`❌ Upstream Error: ${upstreamRes.status} ${upstreamRes.statusText}`);
      return res.status(upstreamRes.status).send('Upstream Error');
    }

    console.log('✅ Connection Established. Spawning FFmpeg...');

    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'video/mp4',
      'Connection': 'keep-alive'
    });

    const ffmpegArgs = [
      // INPUT: Read from Standard Input (pipe:0) instead of URL
      '-i', 'pipe:0',

      // VIDEO: H.264
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',

      // SCALING: Safe 720p
      '-vf', 'scale=-2:720',
      '-pix_fmt', 'yuv420p',

      // AUDIO: AAC
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',

      // FLAGS
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1'
    ];

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

    // 1. Pipe Download -> FFmpeg Input
    upstreamRes.body.pipe(ffmpegProcess.stdin);

    // 2. Pipe FFmpeg Output -> Browser Response
    ffmpegProcess.stdout.pipe(res);

    // Logging
    ffmpegProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('403')) console.log('FFmpeg:', msg.trim());
    });

    req.on('close', () => {
      console.log('Client disconnected, killing FFmpeg');
      ffmpegProcess.kill();
      // Ensure we stop downloading from RD
      if (upstreamRes.body && upstreamRes.body.destroy) upstreamRes.body.destroy();
    });

  } catch (error) {
    console.error('❌ Proxy Fatal Error:', error.message);
    if (!res.headersSent) res.redirect(videoUrl);
  }
});

// ---------------------------------------------------------
// REST OF APP
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