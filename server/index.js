/* global process */
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

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
  const startTime = req.query.startTime;

  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const isMkv = videoUrl.toLowerCase().includes('.mkv');

  try {
    if (isMkv) {
      console.log('Spawning FFmpeg (Direct URL) for:', videoUrl);

      // 2. Validate URL and get headers
      const fetch = (await import('node-fetch')).default;
      const checkRes = await fetch(videoUrl, { method: 'HEAD', headers: { 'User-Agent': 'VLC/3.0.18' } });
      if (!checkRes.ok) {
        console.error('Remote URL check failed:', checkRes.status);
        return res.status(502).send('Upstream source failed');
      }

      // 3. Set Response Headers
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'video/mp4',
        'Connection': 'keep-alive'
      });

      // 4. Spawn FFmpeg Process
      const headers = 'User-Agent: VLC/3.0.18 LibVLC/3.0.18\r\nReferer: https://real-debrid.com/';

      const ffmpegArgs = [
        '-headers', headers,
        ...(startTime ? ['-ss', String(startTime)] : []), // Seek on input (fast)
        '-i', videoUrl,
        '-c:v', 'libx264',
        // '-copyts', // Removed - caused playback issues with some players
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-profile:v', 'main',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-ar', '44100',
        '-ac', '2',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4',
        'pipe:1'
      ];

      const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

      ffmpegProcess.on('error', (err) => {
        console.error('Failed to spawn FFmpeg:', err);
        if (!res.headersSent) {
          res.status(500).send('FFmpeg failed to start');
        }
      });

      // 5. Pipe FFmpeg Stdout -> Response
      ffmpegProcess.stdout.pipe(res);

      // 6. Error Handling & logging
      ffmpegProcess.stderr.on('data', (data) => {
        console.log('FFmpeg:', data.toString()); // Log EVERYTHING for debug
      });

      ffmpegProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        if (!res.writableEnded) res.end();
      });

      // Handle Client Disconnect
      req.on('close', () => {
        console.log('Client disconnected, killing FFmpeg');
        ffmpegProcess.kill();
      });

    } else {
      // Standard Proxy for non-MKV with Range Support
      const fetch = (await import('node-fetch')).default;
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      };

      // Forward Range header if present
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const response = await fetch(videoUrl, { headers });

      // Forward key response headers
      const responseHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': response.headers.get('content-type') || 'video/mp4',
        'Accept-Ranges': 'bytes'
      };

      if (response.headers.has('content-length')) {
        responseHeaders['Content-Length'] = response.headers.get('content-length');
      }
      if (response.headers.has('content-range')) {
        responseHeaders['Content-Range'] = response.headers.get('content-range');
      }

      res.writeHead(response.status, responseHeaders);
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

// Stremio-based Free Subtitles Proxy
app.get('/api/opensubtitles/search', async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Missing query' });
  }

  try {
    const fetch = (await import('node-fetch')).default;

    // 1. Search Cinemeta to get IMDb ID
    const metaUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(query)}.json`;
    console.log('Fetching Meta:', metaUrl);

    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) throw new Error('Meta fetch failed');
    const metaData = await metaRes.json();

    if (!metaData.metas || metaData.metas.length === 0) {
      return res.json({ data: [] });
    }

    // Use the best match (first result)
    const meta = metaData.metas[0];
    const imdbId = meta.imdb_id;
    const movieTitle = meta.name + (meta.releaseInfo ? ` (${meta.releaseInfo})` : '');

    // 2. Fetch Subtitles from Stremio OpenSubtitles v3 Addon
    const subUrl = `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`;
    console.log('Fetching Subs:', subUrl);

    const subRes = await fetch(subUrl);
    if (!subRes.ok) throw new Error('Subtitle fetch failed');
    const subData = await subRes.json();

    // Map Stremio format to our UI expectation
    const subtitles = (subData.subtitles || []).map((sub, idx) => ({
      id: sub.id || idx,
      attributes: {
        feature_details: {
          title: movieTitle,
          year: meta.releaseInfo
        },
        language: sub.lang,
        upload_date: new Date().toISOString(),
        files: [{
          file_id: idx,
          file_name: `Subtitle ${sub.lang} (OpenSubtitles)`,
          download_url: sub.url
        }]
      }
    }));

    // Prioritize English
    const engSubs = subtitles.filter(s => s.attributes.language.startsWith('eng'));
    const otherSubs = subtitles.filter(s => !s.attributes.language.startsWith('eng'));

    res.json({ data: [...engSubs, ...otherSubs] });

  } catch (error) {
    console.error('Proxy Search Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/opensubtitles/download', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }

  try {
    const fetch = (await import('node-fetch')).default;

    console.log('Proxying subtitle download:', url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch subtitle file: ${response.status}`);
    }

    const content = await response.text();
    res.json({ content });

  } catch (error) {
    console.error('Proxy Download Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Socket Logic ...
const rooms = new Map();
io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, username }) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        playlist: [], currentIndex: 0, isPlaying: false, currentTime: 0,
        users: [], messages: [], adminId: socket.id, permissions: 'open',
        subtitle: null // Shared subtitle state { content: string, fileName: string }
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
  socket.on('share_subtitle', ({ roomId, subtitleContent, subtitleFileName, username }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.subtitle = { content: subtitleContent, fileName: subtitleFileName };
      socket.to(roomId).emit('subtitle_shared', { subtitleContent, subtitleFileName, username });
    }
  });
  socket.on('toggle_permissions', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.adminId === socket.id) { room.permissions = room.permissions === 'open' ? 'restricted' : 'open'; io.to(roomId).emit('permissions_updated', { permissions: room.permissions }); }
  });
  socket.on('send_reaction', ({ roomId, emoji }) => io.to(roomId).emit('reaction_received', { emoji, userId: socket.id }));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
