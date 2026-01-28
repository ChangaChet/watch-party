import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';
import './VideoJsTheme.css';
import EmbedPlayer from './EmbedPlayer';
import MovieSearchModal from './MovieSearchModal';

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : 'http://localhost:3001';

const socket = io(SOCKET_URL);

// Simple WebRTC Video Component for User Cameras
const VideoPlayer = ({ stream, muted = false }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
};

function App() {
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');

  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [activeTab, setActiveTab] = useState('chat');
  const [users, setUsers] = useState([]);

  // WebRTC State
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [isMuted, setIsMuted] = useState(true);
  const [facingMode, setFacingMode] = useState('user');
  const [adminId, setAdminId] = useState(null);
  const [permissions, setPermissions] = useState('open');
  const [reactions, setReactions] = useState([]);
  const [speakingUsers, setSpeakingUsers] = useState(new Set());

  const videoRef = useRef(null);
  const localVideoRef = useRef(null);
  const messagesEndRef = useRef(null);
  const roomIdRef = useRef('');
  const usernameRef = useRef('');
  const peersRef = useRef({});
  const localStreamRef = useRef(null);
  const makingOfferRef = useRef({});
  const ignoringOfferRef = useRef({});

  const currentVideoUrl = playlist[currentIndex];

  // Socket Connection Logic
  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected:', socket.id);
      if (roomIdRef.current && usernameRef.current) {
        socket.emit('join_room', { roomId: roomIdRef.current, username: usernameRef.current });
      }
    });

    socket.on('room_state', (data) => {
      setPlaylist(data.playlist);
      setCurrentIndex(data.currentIndex);
      setIsPlaying(data.isPlaying);
      setUsers(data.users || []);
      setAdminId(data.adminId);
      setPermissions(data.permissions || 'open');
      setMessages(data.messages.map(msg => ({
        username: msg.username,
        text: msg.message,
        timestamp: msg.timestamp
      })));
      setJoined(true);
    });

    socket.on('playlist_updated', (data) => {
      if (Array.isArray(data)) setPlaylist(data);
      else if (data.playlist) {
        setPlaylist(data.playlist);
        if (data.currentIndex !== undefined) setCurrentIndex(data.currentIndex);
      }
    });

    socket.on('video_changed', ({ currentIndex: index }) => {
      setCurrentIndex(index);
    });

    // WebRTC & Chat Events
    socket.on('user_joined', ({ username: newUser, users: updatedUsers }) => {
      if (updatedUsers) setUsers(updatedUsers);
      updatedUsers.forEach((user) => {
        if (user.id !== socket.id && !peersRef.current[user.id]) {
          const peer = createPeer(user.id, true);
          peersRef.current[user.id] = { peer, polite: false };
        }
      });
    });

    socket.on('user_left', ({ username: leftUser, users: updatedUsers }) => {
      if (updatedUsers) setUsers(updatedUsers);
      const currentIds = updatedUsers.map(u => u.id);
      Object.keys(peersRef.current).forEach(peerId => {
        if (!currentIds.includes(peerId)) {
          if (peersRef.current[peerId].peer) peersRef.current[peerId].peer.close();
          delete peersRef.current[peerId];
        }
      });
      setRemoteStreams(prev => prev.filter(s => currentIds.includes(s.id)));
    });

    socket.on('chat_message', (message) => {
      setMessages((prev) => [...prev, {
        username: message.username,
        text: message.message,
        timestamp: message.timestamp
      }]);
    });

    // Pass-through signaling
    socket.on('offer', async ({ offer, callerId }) => {
      let peerObj = peersRef.current[callerId];
      let peer;
      if (peerObj) peer = peerObj.peer;
      else {
        peer = createPeer(callerId, false);
        peersRef.current[callerId] = { peer, polite: true };
      }
      try {
        const offerCollision = (peer.signalingState !== 'stable') || makingOfferRef.current[callerId];
        const polite = peersRef.current[callerId]?.polite ?? true;
        ignoringOfferRef.current[callerId] = !polite && offerCollision;
        if (ignoringOfferRef.current[callerId]) return;

        if (peer.signalingState !== 'stable') {
          await Promise.all([
            peer.setLocalDescription({ type: 'rollback' }),
            peer.setRemoteDescription(new RTCSessionDescription(offer))
          ]);
        } else {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
        }

        // Add local tracks
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            peer.addTrack(track, localStreamRef.current);
          });
        }

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('answer', { answer: peer.localDescription, target: callerId, callerId: socket.id });
      } catch (err) { console.error(err); }
    });

    socket.on('answer', async ({ answer, callerId }) => {
      const peerObj = peersRef.current[callerId];
      if (peerObj && peerObj.peer) {
        await peerObj.peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('ice-candidate', async ({ candidate, callerId }) => {
      const peerObj = peersRef.current[callerId];
      if (peerObj && peerObj.peer) {
        await peerObj.peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on('reaction_received', ({ emoji }) => {
      const id = Date.now() + Math.random();
      const x = Math.random() * 80 + 10;
      setReactions(prev => [...prev, { id, emoji, x }]);
      setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 2000);
    });

    return () => {
      socket.off('connect');
      socket.off('room_state');
      socket.off('playlist_updated');
      socket.off('video_changed');
      socket.off('user_joined');
      socket.off('user_left');
      socket.off('chat_message');
    };
  }, []);

  // Helper to create Peer
  const createPeer = (targetId, isInitiator = false) => {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peer.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { candidate: e.candidate, target: targetId, callerId: socket.id });
    };
    peer.ontrack = (e) => {
      const remoteStream = e.streams[0] || new MediaStream([e.track]);
      setRemoteStreams(prev => {
        if (prev.find(p => p.id === targetId)) return prev;
        return [...prev, { id: targetId, stream: remoteStream }];
      });
    };
    return peer;
  };

  // UI Handlers
  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (roomId && username) {
      roomIdRef.current = roomId;
      usernameRef.current = username;
      socket.emit('join_room', { roomId, username });
    }
  };

  const handleToggleMic = async () => {
    if (!localStream) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setLocalStream(stream);
        localStreamRef.current = stream;
        setIsMuted(false);
        // Add to peers
        Object.values(peersRef.current).forEach(({ peer }) => {
          stream.getTracks().forEach(track => peer.addTrack(track, stream));
        });
      } catch (e) { console.error(e); }
    } else {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const handleToggleWebcam = async () => {
    // Basic webcam toggle implementation
    if (localStream && localStream.getVideoTracks().length > 0) {
      localStream.getVideoTracks()[0].stop();
      localStream.removeTrack(localStream.getVideoTracks()[0]);
      setLocalStream(new MediaStream(localStream.getTracks()));
    } else {
      try {
        const vStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const track = vStream.getVideoTracks()[0];
        if (localStream) {
          localStream.addTrack(track);
          setLocalStream(new MediaStream(localStream.getTracks()));
        } else {
          setLocalStream(vStream);
          localStreamRef.current = vStream;
        }
        // Add track to peers
        Object.values(peersRef.current).forEach(({ peer }) => {
          peer.addTrack(track, localStream || vStream);
        });
      } catch (e) { console.error(e); }
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim()) {
      socket.emit('send_message', { roomId, username, message: newMessage });
      setNewMessage('');
    }
  };

  const handleAddVideo = (e) => {
    e.preventDefault();
    if (videoUrl) {
      socket.emit('add_to_playlist', { roomId, videoUrl });
      setVideoUrl('');
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- RENDER ---
  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card glass">
          <h1 className="gradient-text">Watch Party</h1>
          <p className="subtitle">MappleTV Edition</p>
          <form onSubmit={handleJoinRoom}>
            <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required />
            <input className="input" placeholder="Room ID" value={roomId} onChange={e => setRoomId(e.target.value)} required />
            <button type="submit" className="btn btn-primary">Join Room</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header glass">
        <h2 className="gradient-text">Watch Party</h2>
        <div className="header-info">
          <span>Room: {roomId}</span>
          <span>You: {username}</span>
        </div>
      </header>

      <main className="main-content">
        <div className="player-section">
          <div className="player-wrapper">
            {/* --- NEW PLAYER COMPONENT --- */}
            {currentVideoUrl ? (
              <div className="player-container" style={{ width: '100%', height: '100%' }}>
                <EmbedPlayer
                  videoId={currentVideoUrl}
                  socket={socket}
                  roomId={roomId}
                />
              </div>
            ) : (
              <div className="empty-player">
                <p>Add an IMDB ID (e.g. tt1234567) to start watching</p>
              </div>
            )}

            {/* Reaction Overlay */}
            <div className="reactions-container" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
              {reactions.map(r => (
                <div key={r.id} style={{ position: 'absolute', left: `${r.x}%`, bottom: '0', fontSize: '2rem', animation: 'floatUp 2s ease-out forwards' }}>
                  {r.emoji}
                </div>
              ))}
            </div>
          </div>

          <div className="controls glass">
            <div className="reaction-bar" style={{ display: 'flex', gap: '0.5rem' }}>
              {['❤️', '😂', '😲', '🎉', '🔥'].map(emoji => (
                <button key={emoji} onClick={() => socket.emit('send_reaction', { roomId: roomIdRef.current, emoji })} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* User Cams Grid */}
          <div className="video-grid">
            <div className={`video-card`}>
              <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
              <div className="video-username">{username} (You)</div>
              <div className="video-controls">
                <button onClick={handleToggleMic}>{isMuted ? "🔇" : "🎤"}</button>
                <button onClick={handleToggleWebcam}>📷</button>
              </div>
            </div>
            {remoteStreams.map(remote => {
              const user = users.find(u => u.id === remote.id);
              return (
                <div key={remote.id} className="video-card">
                  <VideoPlayer stream={remote.stream} />
                  <div className="video-username">{user?.username || 'User'}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="sidebar glass">
          <div className="tabs">
            <button className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>Chat</button>
            <button className={`tab-btn ${activeTab === 'playlist' ? 'active' : ''}`} onClick={() => setActiveTab('playlist')}>Playlist</button>
          </div>

          {activeTab === 'chat' ? (
            <div className="chat-section">
              <div className="messages-list">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`message ${msg.username === username ? 'own' : ''}`}>
                    <strong>{msg.username}:</strong> {msg.text}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={handleSendMessage} className="chat-form">
                <input className="input" placeholder="Type..." value={newMessage} onChange={e => setNewMessage(e.target.value)} />
                <button type="submit" className="btn">Send</button>
              </form>
            </div>
          ) : (
            <div className="playlist-section">
              <form onSubmit={handleAddVideo}>
                <input className="input" placeholder="IMDB ID (tt12345)" value={videoUrl} onChange={e => setVideoUrl(e.target.value)} />
                <button type="submit" className="btn">+ Add</button>
              </form>
              <div className="playlist-items">
                {playlist.map((url, idx) => (
                  <div key={idx} className={`playlist-item ${idx === currentIndex ? 'active' : ''}`} onClick={() => socket.emit('change_video', { roomId, index: idx })}>
                    {idx + 1}. {url}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

export default App;