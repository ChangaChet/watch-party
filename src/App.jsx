import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : 'http://localhost:3001';

const socket = io(SOCKET_URL);

const extractYouTubeId = (url) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

const VideoPlayer = ({ stream, muted = false }) => {
  const videoRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      setError(null);

      // Attempt to play the video (needed for audio to work in some browsers)
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          console.log('VideoPlayer autoplay prevented:', e);
          // For Safari, we may need user interaction
          if (e.name === 'NotAllowedError') {
            setError('Click to play');
          }
        });
      }

      const checkVideo = () => {
        const videoTracks = stream.getVideoTracks();
        setHasVideo(videoTracks.length > 0 && videoTracks[0].enabled && videoTracks[0].readyState === 'live');
      };

      checkVideo();

      stream.addEventListener('addtrack', checkVideo);
      stream.addEventListener('removetrack', checkVideo);

      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = checkVideo;
        track.onmute = () => setHasVideo(false);
        track.onunmute = () => setHasVideo(true);
      }

      return () => {
        stream.removeEventListener('addtrack', checkVideo);
        stream.removeEventListener('removetrack', checkVideo);
      };
    } else {
      setHasVideo(false);
    }
  }, [stream]);

  const handleClick = () => {
    if (videoRef.current && error) {
      videoRef.current.play()
        .then(() => setError(null))
        .catch(e => console.error('Play failed:', e));
    }
  };

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        webkit-playsinline="true"
        muted={muted}
        style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: hasVideo ? 1 : 0 }}
        onError={(e) => {
          console.error('Video element error:', e);
          setError('Video error');
        }}
        onClick={handleClick}
      />
      {(!hasVideo || error) && (
        <div
          onClick={handleClick}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: error ? '#f59e0b' : '#666',
            background: '#000',
            cursor: error ? 'pointer' : 'default'
          }}
        >
          {error || 'Camera Off'}
        </div>
      )}
    </>
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
  const [videoError, setVideoError] = useState(null);
  const [audioTracks, setAudioTracks] = useState([]);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(0);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState(-1); // -1 = off
  const [showTrackMenu, setShowTrackMenu] = useState(false);

  const videoRef = useRef(null);
  const youtubePlayerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const roomIdRef = useRef('');
  const usernameRef = useRef('');
  const isSyncingRef = useRef(false); // Prevent sync loops
  const currentVideoIdRef = useRef(null); // Track current YouTube video ID
  const isPlayingRef = useRef(false); // Track playing state for refs
  const isYouTubeRef = useRef(false); // Track YouTube state for refs

  const currentVideoUrl = playlist[currentIndex];
  const isYouTube = currentVideoUrl && (currentVideoUrl.includes('youtube.com') || currentVideoUrl.includes('youtu.be'));

  // Update refs when state changes
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    isYouTubeRef.current = isYouTube;
  }, [isPlaying, isYouTube]);

  // Socket listeners
  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected:', socket.id);
      if (roomIdRef.current && usernameRef.current) {
        socket.emit('join_room', { roomId: roomIdRef.current, username: usernameRef.current });
      }
    });

    socket.on('room_state', (data) => {
      console.log('Joined room:', data);
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

      // Seek to current time if there is one
      if (data.currentTime && data.currentTime > 0) {
        setTimeout(() => {
          isSyncingRef.current = true;
          if (isYouTubeRef.current && youtubePlayerRef.current) {
            youtubePlayerRef.current.seekTo(data.currentTime, true);
            if (data.isPlaying) {
              youtubePlayerRef.current.playVideo();
            }
          } else if (videoRef.current) {
            videoRef.current.currentTime = data.currentTime;
            if (data.isPlaying) {
              videoRef.current.play();
            }
          }
          setTimeout(() => { isSyncingRef.current = false; }, 500);
        }, 1000); // Wait for player to be ready
      }
    });

    socket.on('admin_updated', ({ adminId }) => setAdminId(adminId));
    socket.on('permissions_updated', ({ permissions }) => setPermissions(permissions));

    socket.on('reaction_received', ({ emoji }) => {
      const id = Date.now() + Math.random();
      const x = Math.random() * 80 + 10;
      setReactions(prev => [...prev, { id, emoji, x }]);
      setTimeout(() => {
        setReactions(prev => prev.filter(r => r.id !== id));
      }, 2000);
    });

    socket.on('user_speaking', ({ userId, isSpeaking }) => {
      setSpeakingUsers(prev => {
        const newSet = new Set(prev);
        if (isSpeaking) newSet.add(userId);
        else newSet.delete(userId);
        return newSet;
      });
    });

    socket.on('kicked', () => {
      alert('You have been kicked from the room.');
      window.location.reload();
    });

    socket.on('user_joined', async ({ username: newUser, users: updatedUsers }) => {
      console.log(`${newUser} joined`);
      if (updatedUsers) setUsers(updatedUsers);

      // Initiate WebRTC call to new user
      updatedUsers.forEach((user) => {
        if (user.id !== socket.id && !peersRef.current[user.id]) {
          console.log('Creating peer connection to', user.id, '(as initiator/impolite)');
          const peer = createPeer(user.id, true);
          peersRef.current[user.id] = { peer, polite: false }; // Initiator is impolite
        }
      });
    });

    socket.on('user_left', ({ username: leftUser, users: updatedUsers }) => {
      console.log(`${leftUser} left`);
      if (updatedUsers) setUsers(updatedUsers);

      const currentIds = updatedUsers.map(u => u.id);

      // Cleanup peers
      Object.keys(peersRef.current).forEach(peerId => {
        if (!currentIds.includes(peerId)) {
          if (peersRef.current[peerId].peer) {
            peersRef.current[peerId].peer.close();
          }
          delete peersRef.current[peerId];
        }
      });

      // Cleanup streams - Force remove any stream not in currentIds
      setRemoteStreams(prev => prev.filter(s => currentIds.includes(s.id)));
    });

    // WebRTC Signaling Listeners
    socket.on('offer', async ({ offer, callerId }) => {
      console.log('Received offer from', callerId);
      let peerObj = peersRef.current[callerId];
      let peer;

      if (peerObj) {
        peer = peerObj.peer;
      } else {
        peer = createPeer(callerId, false);
        peersRef.current[callerId] = { peer, polite: true }; // Receiver is polite
      }

      try {
        // Perfect negotiation pattern
        const offerCollision = (peer.signalingState !== 'stable') || makingOfferRef.current[callerId];
        const polite = peersRef.current[callerId]?.polite ?? true;

        ignoringOfferRef.current[callerId] = !polite && offerCollision;

        if (ignoringOfferRef.current[callerId]) {
          console.log('Ignoring offer from', callerId, 'due to collision (we are impolite)');
          return;
        }

        // If we're in the middle of something, rollback
        if (peer.signalingState !== 'stable') {
          console.log('Rolling back local description for', callerId);
          await Promise.all([
            peer.setLocalDescription({ type: 'rollback' }),
            peer.setRemoteDescription(new RTCSessionDescription(offer))
          ]);
        } else {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
        }

        // Make sure local tracks are added before creating answer
        if (localStreamRef.current) {
          const senders = peer.getSenders();
          localStreamRef.current.getTracks().forEach(track => {
            const existingSender = senders.find(s => s.track && s.track.kind === track.kind);
            if (!existingSender) {
              console.log('Adding local track before answer:', track.kind);
              peer.addTrack(track, localStreamRef.current);
            }
          });
        }

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        console.log('Sending answer to', callerId);
        socket.emit('answer', { answer: peer.localDescription, target: callerId, callerId: socket.id });
      } catch (err) {
        console.error('Error handling offer from', callerId, ':', err);
      }
    });

    socket.on('answer', async ({ answer, callerId }) => {
      console.log('Received answer from', callerId);
      const peerObj = peersRef.current[callerId];
      if (peerObj && peerObj.peer) {
        try {
          // Only set if we're expecting an answer
          if (peerObj.peer.signalingState === 'have-local-offer') {
            await peerObj.peer.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('Remote description set for', callerId);
          } else {
            console.log('Unexpected answer from', callerId, '- signaling state:', peerObj.peer.signalingState);
          }
        } catch (err) {
          console.error('Error handling answer:', err);
        }
      }
    });

    socket.on('ice-candidate', async ({ candidate, callerId }) => {
      const peerObj = peersRef.current[callerId];
      if (peerObj && peerObj.peer) {
        try {
          // Only add ICE candidates if we're not ignoring this peer
          if (!ignoringOfferRef.current[callerId]) {
            await peerObj.peer.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch (err) {
          // ICE candidate errors are often harmless during renegotiation
          if (err.name !== 'InvalidStateError') {
            console.error('Error adding ice candidate:', err);
          }
        }
      }
    });

    socket.on('playlist_updated', (data) => {
      if (Array.isArray(data)) {
        setPlaylist(data);
      } else if (data.playlist) {
        setPlaylist(data.playlist);
        if (data.currentIndex !== undefined) setCurrentIndex(data.currentIndex);
      }
    });

    socket.on('video_changed', ({ currentIndex: index, isPlaying: playing }) => {
      setCurrentIndex(index);
      setIsPlaying(playing);
      isPlayingRef.current = playing;
    });

    socket.on('sync_play', ({ currentTime }) => {
      const timeDiff = Math.abs((youtubePlayerRef.current ? youtubePlayerRef.current.getCurrentTime() : videoRef.current ? videoRef.current.currentTime : 0) - currentTime);

      if (isPlayingRef.current && timeDiff < 2) {
        return; // Already playing and synced, ignore
      }

      isSyncingRef.current = true;
      setIsPlaying(true);
      isPlayingRef.current = true;

      if (isYouTubeRef.current && youtubePlayerRef.current) {
        if (timeDiff >= 2) youtubePlayerRef.current.seekTo(currentTime, true);
        youtubePlayerRef.current.playVideo();
      } else if (videoRef.current) {
        if (timeDiff >= 2) videoRef.current.currentTime = currentTime;
        videoRef.current.play();
      }
      setTimeout(() => { isSyncingRef.current = false; }, 1000);
    });

    socket.on('sync_pause', ({ currentTime }) => {
      const timeDiff = Math.abs((youtubePlayerRef.current ? youtubePlayerRef.current.getCurrentTime() : videoRef.current ? videoRef.current.currentTime : 0) - currentTime);

      if (!isPlayingRef.current && timeDiff < 2) {
        return; // Already paused and synced, ignore
      }

      isSyncingRef.current = true;
      setIsPlaying(false);
      isPlayingRef.current = false;

      if (isYouTubeRef.current && youtubePlayerRef.current) {
        youtubePlayerRef.current.seekTo(currentTime, true);
        youtubePlayerRef.current.pauseVideo();
      } else if (videoRef.current) {
        videoRef.current.currentTime = currentTime;
        videoRef.current.pause();
      }
      setTimeout(() => { isSyncingRef.current = false; }, 1000);
    });

    socket.on('sync_seek', ({ currentTime, isPlaying: shouldPlay }) => {
      isSyncingRef.current = true;
      if (isYouTubeRef.current && youtubePlayerRef.current) {
        youtubePlayerRef.current.seekTo(currentTime, true);
        if (shouldPlay) {
          youtubePlayerRef.current.playVideo();
        } else if (shouldPlay === false) {
          youtubePlayerRef.current.pauseVideo();
        }
      } else if (videoRef.current) {
        videoRef.current.currentTime = currentTime;
        if (shouldPlay) {
          videoRef.current.play();
        } else if (shouldPlay === false) {
          videoRef.current.pause();
        }
      }
      if (shouldPlay !== undefined) {
        setIsPlaying(shouldPlay);
        isPlayingRef.current = shouldPlay;
      }
      setTimeout(() => { isSyncingRef.current = false; }, 1000);
    });

    // Handle sync request from new user
    socket.on('request_sync', ({ requesterId }) => {
      let currentTime = 0;
      if (isYouTubeRef.current && youtubePlayerRef.current) {
        currentTime = youtubePlayerRef.current.getCurrentTime();
      } else if (videoRef.current) {
        currentTime = videoRef.current.currentTime;
      }
      socket.emit('sync_response', { requesterId, currentTime, isPlaying: isPlayingRef.current });
    });

    socket.on('user_muted', ({ userId, isMuted }) => {
      setRemoteStreams(prev => prev.map(p => p.id === userId ? { ...p, isMuted } : p));
    });

    socket.on('chat_message', (message) => {
      setMessages((prev) => [...prev, {
        username: message.username,
        text: message.message,
        timestamp: message.timestamp
      }]);
    });

    return () => {
      socket.off('connect');
      socket.off('room_state');
      socket.off('user_joined');
      socket.off('user_left');
      socket.off('playlist_updated');
      socket.off('video_changed');
      socket.off('sync_play');
      socket.off('sync_pause');
      socket.off('sync_seek');
      socket.off('request_sync');
      socket.off('chat_message');
    };
  }, []); // Run only once

  // Load YouTube API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // Initialize YouTube player - ONLY when video ID actually changes
  useEffect(() => {
    if (isYouTube && currentVideoUrl && window.YT && window.YT.Player) {
      const videoId = extractYouTubeId(currentVideoUrl);

      // Only recreate if video ID changed
      if (videoId && videoId !== currentVideoIdRef.current) {
        console.log('Creating YouTube player for:', videoId);
        currentVideoIdRef.current = videoId;

        // Destroy old player
        if (youtubePlayerRef.current) {
          youtubePlayerRef.current.destroy();
        }

        // Create new player
        youtubePlayerRef.current = new window.YT.Player('youtube-player', {
          videoId: videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            playsinline: 1
          },
          events: {
            onReady: (event) => {
              // If video should be playing when user joins, start it
              if (isPlayingRef.current) {
                event.target.playVideo();
              }
              // Explicitly ask for sync when ready
              socket.emit('ask_for_time', { roomId: roomIdRef.current });
            },
            onStateChange: (event) => {
              if (isSyncingRef.current) return; // Don't emit if we're syncing

              if (event.data === window.YT.PlayerState.PLAYING) {
                if (!isPlayingRef.current) { // Only emit if state changed
                  const currentTime = youtubePlayerRef.current.getCurrentTime();
                  setIsPlaying(true);
                  socket.emit('sync_action', { roomId: roomIdRef.current, action: 'play', data: { currentTime } });
                }
              } else if (event.data === window.YT.PlayerState.PAUSED) {
                if (isPlayingRef.current) { // Only emit if state changed
                  const currentTime = youtubePlayerRef.current.getCurrentTime();
                  setIsPlaying(false);
                  socket.emit('sync_action', { roomId: roomIdRef.current, action: 'pause', data: { currentTime } });
                }
              }
            }
          }
        });
      }
    } else if (!isYouTube) {
      // Clear video ID ref when switching to non-YouTube
      currentVideoIdRef.current = null;
    }
  }, [currentVideoUrl, isYouTube]); // Removed isPlaying and roomId from dependencies

  // Auto-play MP4 videos if they should be playing when user joins
  useEffect(() => {
    if (!isYouTube && videoRef.current && currentVideoUrl && isPlaying) {
      videoRef.current.play().catch(e => console.log('Auto-play prevented:', e));
    }
  }, [currentVideoUrl, isYouTube, isPlaying]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);



  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]); // Array of { id, stream, username, isMuted }
  const [isMuted, setIsMuted] = useState(true);
  const [facingMode, setFacingMode] = useState('user');
  const [adminId, setAdminId] = useState(null);
  const [permissions, setPermissions] = useState('open');
  const [reactions, setReactions] = useState([]);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [speakingUsers, setSpeakingUsers] = useState(new Set());
  const [maximizedVideo, setMaximizedVideo] = useState(null);

  const peersRef = useRef({}); // socketId -> { peer: RTCPeerConnection, polite: boolean }
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null); // Keep for local preview in grid
  const makingOfferRef = useRef({}); // Track if we're in the middle of making an offer
  const ignoringOfferRef = useRef({}); // For perfect negotiation pattern

  // Helper to renegotiate a peer connection (send new offer)
  const renegotiatePeer = async (targetId, peer) => {
    if (makingOfferRef.current[targetId]) {
      console.log('Already making offer to', targetId, '- skipping');
      return;
    }

    makingOfferRef.current[targetId] = true;
    console.log('Starting renegotiation with', targetId);

    try {
      const offer = await peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: false
      });

      // Check if the signaling state is still valid
      if (peer.signalingState !== 'stable' && peer.signalingState !== 'have-local-offer') {
        console.log('Signaling state not ready:', peer.signalingState, '- skipping offer');
        return;
      }

      await peer.setLocalDescription(offer);
      console.log('Sending offer to', targetId);
      socket.emit('offer', { offer: peer.localDescription, target: targetId, callerId: socket.id });
    } catch (err) {
      console.error('Error renegotiating with', targetId, ':', err);
    } finally {
      makingOfferRef.current[targetId] = false;
    }
  };

  // Helper to create peer connection
  const createPeer = (targetId, isInitiator = false) => {
    const peer = new RTCPeerConnection({
      iceServers: [
        // STUN servers
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Free TURN servers from Metered
        {
          urls: 'turn:a.relay.metered.ca:80',
          username: 'e918c18959e4ca5e02b6f882',
          credential: 'rseLhk/YqIOE+xXx'
        },
        {
          urls: 'turn:a.relay.metered.ca:80?transport=tcp',
          username: 'e918c18959e4ca5e02b6f882',
          credential: 'rseLhk/YqIOE+xXx'
        },
        {
          urls: 'turn:a.relay.metered.ca:443',
          username: 'e918c18959e4ca5e02b6f882',
          credential: 'rseLhk/YqIOE+xXx'
        },
        {
          urls: 'turn:a.relay.metered.ca:443?transport=tcp',
          username: 'e918c18959e4ca5e02b6f882',
          credential: 'rseLhk/YqIOE+xXx'
        }
      ],
      iceCandidatePoolSize: 10
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate to', targetId);
        socket.emit('ice-candidate', { candidate: event.candidate, target: targetId, callerId: socket.id });
      }
    };

    peer.oniceconnectionstatechange = () => {
      console.log(`ICE connection state with ${targetId}:`, peer.iceConnectionState);
      // Log when connection fails
      if (peer.iceConnectionState === 'failed') {
        console.error('ICE connection failed with', targetId);
        // Try to restart ICE
        peer.restartIce();
      }
      if (peer.iceConnectionState === 'disconnected') {
        console.warn('ICE disconnected from', targetId, '- may reconnect');
      }
      if (peer.iceConnectionState === 'connected') {
        console.log('Successfully connected to', targetId);
      }
    };

    peer.onconnectionstatechange = () => {
      console.log(`Connection state with ${targetId}:`, peer.connectionState);
    };

    // Enable negotiation for ALL peers - when tracks are added, trigger renegotiation
    peer.onnegotiationneeded = async () => {
      console.log('Negotiation needed with', targetId, '(isInitiator:', isInitiator, ')');
      await renegotiatePeer(targetId, peer);
    };

    peer.ontrack = (event) => {
      console.log('Received track from', targetId, '- kind:', event.track.kind, '- readyState:', event.track.readyState);

      // Listen for track becoming live
      event.track.onunmute = () => {
        console.log('Track unmuted from', targetId, event.track.kind);
      };

      setRemoteStreams(prev => {
        const existing = prev.find(p => p.id === targetId);
        if (existing) {
          // If stream is different, update it
          if (existing.stream.id !== event.streams[0].id) {
            console.log('Updating stream for', targetId);
            return prev.map(p => p.id === targetId ? { ...p, stream: event.streams[0] } : p);
          }
          return prev;
        }
        console.log('Adding new remote stream for', targetId);
        return [...prev, { id: targetId, stream: event.streams[0] }];
      });
    };

    // Add local tracks if they exist
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        console.log('Adding local track to peer', targetId, ':', track.kind, '- enabled:', track.enabled);
        peer.addTrack(track, localStreamRef.current);
      });
    }

    return peer;
  };

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const handleScreenShare = async () => {
    if (isScreenSharing) {
      if (localStream) {
        localStream.getVideoTracks().forEach(t => t.stop());
        // If audio exists, keep it? 
        // For simplicity, let's just stop video and keep audio if it was there.
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
          const newStream = new MediaStream([audioTrack]);
          setLocalStream(newStream);
          localStreamRef.current = newStream;
        } else {
          setLocalStream(null);
          localStreamRef.current = null;
        }

        Object.values(peersRef.current).forEach(({ peer }) => {
          const senders = peer.getSenders();
          const sender = senders.find(s => s.track && s.track.kind === 'video');
          if (sender) peer.removeTrack(sender);
        });
      }
      setIsScreenSharing(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const screenTrack = stream.getVideoTracks()[0];

        screenTrack.onended = () => {
          setIsScreenSharing(false);
          // Handle cleanup similar to above if needed
        };

        if (localStream) {
          const audioTrack = localStream.getAudioTracks()[0];
          const newStream = new MediaStream([screenTrack]);
          if (audioTrack) newStream.addTrack(audioTrack);

          setLocalStream(newStream);
          localStreamRef.current = newStream;

          Object.values(peersRef.current).forEach(({ peer }) => {
            const senders = peer.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) videoSender.replaceTrack(screenTrack);
            else peer.addTrack(screenTrack, newStream);
          });
        } else {
          setLocalStream(stream);
          localStreamRef.current = stream;
          Object.values(peersRef.current).forEach(({ peer }) => {
            stream.getTracks().forEach(track => peer.addTrack(track, stream));
          });
        }
        setIsScreenSharing(true);
      } catch (err) { console.error("Error sharing screen:", err); }
    }
  };

  const handleToggleWebcam = async () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        // Turning OFF camera
        videoTrack.stop();
        localStream.removeTrack(videoTrack);
        Object.entries(peersRef.current).forEach(([peerId, { peer }]) => {
          const senders = peer.getSenders();
          const sender = senders.find(s => s.track && s.track.kind === 'video');
          if (sender) {
            peer.removeTrack(sender);
            // Force renegotiation
            renegotiatePeer(peerId, peer);
          }
        });
        if (localStream.getAudioTracks().length === 0) {
          setLocalStream(null);
          localStreamRef.current = null;
        } else {
          const newStream = new MediaStream(localStream.getTracks());
          setLocalStream(newStream);
          localStreamRef.current = newStream;
        }
      } else {
        // Turning ON camera (when audio stream already exists)
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
          const newVideoTrack = videoStream.getVideoTracks()[0];
          localStream.addTrack(newVideoTrack);
          const newStream = new MediaStream(localStream.getTracks());
          setLocalStream(newStream);
          localStreamRef.current = newStream;

          // Add track to all peers and renegotiate
          Object.entries(peersRef.current).forEach(([peerId, { peer }]) => {
            peer.addTrack(newVideoTrack, newStream);
            // Force renegotiation to send the new track
            renegotiatePeer(peerId, peer);
          });
        } catch (err) { console.error('Error getting video:', err); }
      }
    } else {
      // No stream exists - get both video and audio
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true });
        stream.getAudioTracks().forEach(t => t.enabled = false);
        setIsMuted(true);
        socket.emit('toggle_mute', { roomId: roomIdRef.current, isMuted: true });
        setLocalStream(stream);
        localStreamRef.current = stream;

        // Add tracks to all peers and renegotiate
        Object.entries(peersRef.current).forEach(([peerId, { peer }]) => {
          stream.getTracks().forEach(track => {
            console.log('Adding track to peer:', peerId, track.kind);
            peer.addTrack(track, stream);
          });
          // Force renegotiation
          renegotiatePeer(peerId, peer);
        });
      } catch (err) { console.error('Error getting media:', err); }
    }
  };

  const handleFlipCamera = async () => {
    if (!localStream || localStream.getVideoTracks().length === 0) return;
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    localStream.getVideoTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: newMode } });
      const newTrack = stream.getVideoTracks()[0];
      localStream.getVideoTracks().forEach(t => localStream.removeTrack(t));
      localStream.addTrack(newTrack);
      setLocalStream(new MediaStream(localStream.getTracks()));
      localStreamRef.current = new MediaStream(localStream.getTracks());
      Object.values(peersRef.current).forEach(({ peer }) => {
        const senders = peer.getSenders();
        const sender = senders.find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(newTrack);
        else peer.addTrack(newTrack, localStream);
      });
    } catch (err) { console.error("Error flipping camera:", err); }
  };

  const handleToggleMic = async () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        // Just toggle enable/disable - no need to renegotiate
        audioTrack.enabled = !audioTrack.enabled;
        const isNowMuted = !audioTrack.enabled;
        setIsMuted(isNowMuted);
        socket.emit('toggle_mute', { roomId: roomIdRef.current, isMuted: isNowMuted });
      } else {
        // Add new audio track
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const newAudioTrack = audioStream.getAudioTracks()[0];
          localStream.addTrack(newAudioTrack);
          const newStream = new MediaStream(localStream.getTracks());
          setLocalStream(newStream);
          localStreamRef.current = newStream;
          setIsMuted(false);
          socket.emit('toggle_mute', { roomId: roomIdRef.current, isMuted: false });

          // Add track to all peers and renegotiate
          Object.entries(peersRef.current).forEach(([peerId, { peer }]) => {
            peer.addTrack(newAudioTrack, newStream);
            renegotiatePeer(peerId, peer);
          });
        } catch (err) { console.error('Error getting audio:', err); }
      }
    } else {
      // No stream exists - get audio only
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setLocalStream(stream);
        localStreamRef.current = stream;
        setIsMuted(false);
        socket.emit('toggle_mute', { roomId: roomIdRef.current, isMuted: false });

        // Add tracks to all peers and renegotiate
        Object.entries(peersRef.current).forEach(([peerId, { peer }]) => {
          stream.getTracks().forEach(track => peer.addTrack(track, stream));
          renegotiatePeer(peerId, peer);
        });
      } catch (err) { console.error('Error getting audio:', err); }
    }
  };

  const handleRemoveVideo = (e, index) => {
    e.stopPropagation(); // Prevent playing the video
    if (window.confirm('Remove this video from playlist?')) {
      socket.emit('remove_from_playlist', { roomId: roomIdRef.current, index });
    }
  };

  // Audio Analysis Effect
  useEffect(() => {
    if (!localStream) return;

    // Check if audio track exists and is enabled
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack || !audioTrack.enabled) return;

    let audioContext;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.error("AudioContext not supported", e);
      return;
    }

    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(localStream);
    const scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;

    microphone.connect(analyser);
    analyser.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    let lastSpeakingState = false;
    let speakingFrames = 0;

    scriptProcessor.onaudioprocess = () => {
      const array = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(array);
      let values = 0;
      const length = array.length;
      for (let i = 0; i < length; i++) {
        values += array[i];
      }
      const average = values / length;

      const isSpeaking = average > 10; // Threshold

      if (isSpeaking) {
        speakingFrames++;
      } else {
        speakingFrames = Math.max(0, speakingFrames - 1);
      }

      const isSpeakingStable = speakingFrames > 5; // Debounce

      if (isSpeakingStable !== lastSpeakingState) {
        lastSpeakingState = isSpeakingStable;
        socket.emit('speaking_status', { roomId: roomIdRef.current, isSpeaking: isSpeakingStable });
        setSpeakingUsers(prev => {
          const newSet = new Set(prev);
          if (isSpeakingStable) newSet.add(socket.id);
          else newSet.delete(socket.id);
          return newSet;
        });
      }
    };

    return () => {
      scriptProcessor.disconnect();
      analyser.disconnect();
      microphone.disconnect();
      audioContext.close();
    };
  }, [localStream, isMuted]);

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (roomId && username) {
      roomIdRef.current = roomId;
      usernameRef.current = username;
      socket.emit('join_room', { roomId, username });
    }
  };

  // Detect available audio and subtitle tracks when video loads
  const handleVideoLoaded = () => {
    const video = videoRef.current;
    if (!video) return;

    // Reset error state
    setVideoError(null);

    // Detect audio tracks (limited browser support)
    if (video.audioTracks && video.audioTracks.length > 0) {
      const tracks = [];
      for (let i = 0; i < video.audioTracks.length; i++) {
        const track = video.audioTracks[i];
        tracks.push({
          id: i,
          label: track.label || track.language || `Audio ${i + 1}`,
          language: track.language
        });
      }
      setAudioTracks(tracks);
    } else {
      setAudioTracks([]);
    }

    // Detect text/subtitle tracks
    if (video.textTracks && video.textTracks.length > 0) {
      const tracks = [];
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        tracks.push({
          id: i,
          label: track.label || track.language || `Subtitle ${i + 1}`,
          language: track.language,
          kind: track.kind
        });
      }
      setSubtitleTracks(tracks);
    } else {
      setSubtitleTracks([]);
    }

    // Ask for sync time
    socket.emit('ask_for_time', { roomId: roomIdRef.current });
  };

  // Switch audio track
  const switchAudioTrack = (trackIndex) => {
    const video = videoRef.current;
    if (!video || !video.audioTracks) return;

    for (let i = 0; i < video.audioTracks.length; i++) {
      video.audioTracks[i].enabled = (i === trackIndex);
    }
    setSelectedAudioTrack(trackIndex);
  };

  // Switch subtitle track
  const switchSubtitleTrack = (trackIndex) => {
    const video = videoRef.current;
    if (!video || !video.textTracks) return;

    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = (i === trackIndex) ? 'showing' : 'hidden';
    }
    setSelectedSubtitleTrack(trackIndex);
  };


  const handleAddVideo = (e) => {
    e.preventDefault();
    if (!videoUrl) return;

    try {
      new URL(videoUrl);
    } catch (_) {
      alert("Please enter a valid URL (e.g., https://youtube.com/...)");
      return;
    }

    socket.emit('add_to_playlist', { roomId, videoUrl });
    setVideoUrl('');
  };

  const handleChangeVideo = (index) => {
    socket.emit('change_video', { roomId, index });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim()) {
      socket.emit('send_message', { roomId, username, message: newMessage });
      setNewMessage('');
    }
  };

  const handleVideoPlay = () => {
    if (isSyncingRef.current) return; // Don't emit if we're syncing from another user
    const currentTime = videoRef.current ? videoRef.current.currentTime : 0;
    setIsPlaying(true);
    socket.emit('sync_action', { roomId: roomIdRef.current, action: 'play', data: { currentTime } });
  };

  const handleVideoPause = () => {
    if (isSyncingRef.current) return; // Don't emit if we're syncing from another user
    const currentTime = videoRef.current ? videoRef.current.currentTime : 0;
    setIsPlaying(false);
    socket.emit('sync_action', { roomId: roomIdRef.current, action: 'pause', data: { currentTime } });
  };

  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card glass">
          <h1 className="gradient-text">Watch Party</h1>
          <p className="subtitle">Watch videos in perfect sync with friends</p>
          <form onSubmit={handleJoinRoom}>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                className="input"
                placeholder="Enter your name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Room ID</label>
              <input
                type="text"
                className="input"
                placeholder="Enter room name"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary">Join Room</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header glass">
        <div className="logo">
          <h2 className="gradient-text">Watch Party</h2>
        </div>
        <div className="header-info">
          <span className="room-badge">Room: {roomId}</span>
          <span className="user-badge">👥 {users.length} {users.length === 1 ? 'User' : 'Users'}</span>
          <span className="user-badge" title={users.map(u => u.username).join(', ')}>
            You: {username}
          </span>
        </div>
      </header>

      <main className="main-content">
        <div className="player-section">
          <div className="player-wrapper">
            {currentVideoUrl ? (
              <div className="player-container">
                {isYouTube ? (
                  <div id="youtube-player" style={{ width: '100%', height: '100%' }}></div>
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      src={currentVideoUrl}
                      controls
                      style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
                      onPlay={handleVideoPlay}
                      onPause={handleVideoPause}
                      onLoadedMetadata={handleVideoLoaded}
                      onError={(e) => {
                        console.error('Video load error:', e);
                        const video = e.target;
                        let errorMsg = 'Failed to load video';
                        if (video.error) {
                          switch (video.error.code) {
                            case 1: errorMsg = 'Video loading aborted'; break;
                            case 2: errorMsg = 'Network error - check your connection'; break;
                            case 3: errorMsg = 'Video format not supported (try MP4 instead of MKV)'; break;
                            case 4: errorMsg = 'Video not found or access denied'; break;
                            default: errorMsg = 'Unknown video error';
                          }
                        }
                        setVideoError(errorMsg);
                      }}
                      onCanPlay={() => setVideoError(null)}
                      playsInline
                      webkit-playsinline="true"
                    />

                    {/* Track Selection Button */}
                    {(audioTracks.length > 1 || subtitleTracks.length > 0) && (
                      <button
                        onClick={() => setShowTrackMenu(!showTrackMenu)}
                        style={{
                          position: 'absolute',
                          top: '10px',
                          right: '10px',
                          background: 'rgba(0,0,0,0.7)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '5px',
                          padding: '8px 12px',
                          cursor: 'pointer',
                          fontSize: '0.9rem',
                          zIndex: 15
                        }}
                      >
                        ⚙️ Tracks
                      </button>
                    )}

                    {/* Track Selection Menu */}
                    {showTrackMenu && (
                      <div style={{
                        position: 'absolute',
                        top: '50px',
                        right: '10px',
                        background: 'rgba(0,0,0,0.95)',
                        color: 'white',
                        borderRadius: '8px',
                        padding: '1rem',
                        minWidth: '200px',
                        zIndex: 30,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                          <strong>Track Settings</strong>
                          <button
                            onClick={() => setShowTrackMenu(false)}
                            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}
                          >✕</button>
                        </div>

                        {/* Audio Tracks */}
                        {audioTracks.length > 1 && (
                          <div style={{ marginBottom: '1rem' }}>
                            <div style={{ fontSize: '0.8rem', color: '#aaa', marginBottom: '0.5rem' }}>🔊 Audio Track</div>
                            {audioTracks.map((track, idx) => (
                              <button
                                key={idx}
                                onClick={() => switchAudioTrack(idx)}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'left',
                                  background: selectedAudioTrack === idx ? 'rgba(99, 102, 241, 0.5)' : 'rgba(255,255,255,0.1)',
                                  color: 'white',
                                  border: 'none',
                                  padding: '0.5rem',
                                  marginBottom: '0.25rem',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                {selectedAudioTrack === idx && '✓ '}{track.label}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Subtitle Tracks */}
                        {subtitleTracks.length > 0 && (
                          <div>
                            <div style={{ fontSize: '0.8rem', color: '#aaa', marginBottom: '0.5rem' }}>📝 Subtitles</div>
                            <button
                              onClick={() => switchSubtitleTrack(-1)}
                              style={{
                                display: 'block',
                                width: '100%',
                                textAlign: 'left',
                                background: selectedSubtitleTrack === -1 ? 'rgba(99, 102, 241, 0.5)' : 'rgba(255,255,255,0.1)',
                                color: 'white',
                                border: 'none',
                                padding: '0.5rem',
                                marginBottom: '0.25rem',
                                borderRadius: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              {selectedSubtitleTrack === -1 && '✓ '}Off
                            </button>
                            {subtitleTracks.map((track, idx) => (
                              <button
                                key={idx}
                                onClick={() => switchSubtitleTrack(idx)}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'left',
                                  background: selectedSubtitleTrack === idx ? 'rgba(99, 102, 241, 0.5)' : 'rgba(255,255,255,0.1)',
                                  color: 'white',
                                  border: 'none',
                                  padding: '0.5rem',
                                  marginBottom: '0.25rem',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                {selectedSubtitleTrack === idx && '✓ '}{track.label}
                              </button>
                            ))}
                          </div>
                        )}

                        {audioTracks.length <= 1 && subtitleTracks.length === 0 && (
                          <div style={{ color: '#aaa', fontSize: '0.9rem' }}>
                            No additional tracks available.
                            <br /><br />
                            <small>Note: MKV files with embedded tracks are not supported by browsers. Use MP4 or HLS streams for multiple audio/subtitle tracks.</small>
                          </div>
                        )}
                      </div>
                    )}

                    {videoError && (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(0,0,0,0.9)',
                        color: '#ef4444',
                        padding: '2rem',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{videoError}</div>
                        <div style={{ fontSize: '0.9rem', color: '#999', maxWidth: '300px' }}>
                          This video may not be compatible with your browser. Try a different browser or video source.
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="empty-player">
                <div className="empty-icon">📺</div>
                <p>Add a video to start watching</p>
              </div>
            )}
            <div className="reactions-container" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 20 }}>
              {reactions.map(r => (
                <div key={r.id} style={{
                  position: 'absolute',
                  left: `${r.x}%`,
                  bottom: '0',
                  fontSize: '2rem',
                  animation: 'floatUp 2s ease-out forwards'
                }}>
                  {r.emoji}
                </div>
              ))}
            </div>
          </div>

          <div className="controls glass">
            <div className="video-info">
              {currentVideoUrl ? (
                <span>Now Playing: <span className="gradient-text">{currentVideoUrl}</span></span>
              ) : (
                <span>No video selected</span>
              )}
            </div>

            <div className="reaction-bar" style={{ display: 'flex', gap: '0.5rem', marginLeft: '1rem' }}>
              {['❤️', '😂', '😲', '🎉', '🔥'].map(emoji => (
                <button
                  key={emoji}
                  onClick={() => socket.emit('send_reaction', { roomId: roomIdRef.current, emoji })}
                  style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: '0' }}
                  className="emoji-btn"
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div style={{ fontSize: '10px', color: '#aaa' }}>
              State: {isPlaying ? 'PLAYING' : 'PAUSED'} | Index: {currentIndex} | Type: {isYouTube ? 'YouTube' : 'MP4'}
            </div>
            {isPlaying && (
              <button
                className="btn"
                onClick={() => {
                  if (isYouTubeRef.current && youtubePlayerRef.current) youtubePlayerRef.current.playVideo();
                  else if (videoRef.current) videoRef.current.play();
                }}
                style={{ marginLeft: 'auto', background: '#22c55e', padding: '0.25rem 0.5rem', fontSize: '0.8rem', minWidth: 'auto' }}
              >
                Force Play
              </button>
            )}
          </div>

          <div className="video-grid">
            {/* Local User */}
            <div className={`video-card ${speakingUsers.has(socket.id) ? 'speaking' : ''}`}>
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={{
                  opacity: (localStream && localStream.getVideoTracks().length > 0) ? 1 : 0,
                  transform: isScreenSharing ? 'none' : 'scaleX(-1)'
                }}
              />
              {(!localStream || localStream.getVideoTracks().length === 0) && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                  Camera Off
                </div>
              )}
              <div className="video-username">
                {username} (You)
              </div>
              <div className="video-controls">
                <button
                  className={`control-btn ${isMuted ? 'off' : ''}`}
                  onClick={handleToggleMic}
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? "🔇" : "🎤"}
                </button>
                <button
                  className={`control-btn ${(!localStream || localStream.getVideoTracks().length === 0) ? 'off' : ''}`}
                  onClick={handleToggleWebcam}
                  title={(localStream && localStream.getVideoTracks().length > 0) ? "Turn Off Camera" : "Turn On Camera"}
                >
                  {(localStream && localStream.getVideoTracks().length > 0) ? "📷" : "🚫"}
                </button>
                <button
                  className={`control-btn ${isScreenSharing ? 'active' : ''}`}
                  onClick={handleScreenShare}
                  title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
                >
                  {isScreenSharing ? "🛑" : "🖥️"}
                </button>
                {localStream && localStream.getVideoTracks().length > 0 && !isScreenSharing && (
                  <button
                    className="control-btn"
                    onClick={handleFlipCamera}
                    title="Flip Camera"
                  >
                    🔄
                  </button>
                )}
                <button
                  className="control-btn"
                  onClick={() => setMaximizedVideo({ stream: localStream, username: `${username} (You)`, isLocal: true })}
                  title="Maximize"
                >
                  ⤢
                </button>
              </div>
            </div>

            {/* Remote Users */}
            {remoteStreams.map(remote => {
              const user = users.find(u => u.id === remote.id);
              if (!user) return null;
              const remoteUsername = user.username;
              return (
                <div key={remote.id} className={`video-card ${speakingUsers.has(remote.id) ? 'speaking' : ''}`}>
                  <VideoPlayer stream={remote.stream} />
                  <div className="video-username">
                    {remoteUsername}
                  </div>
                  <div className="video-controls">
                    <button
                      className="control-btn"
                      onClick={() => setMaximizedVideo({ stream: remote.stream, username: remoteUsername, isLocal: false })}
                      title="Maximize"
                    >
                      ⤢
                    </button>
                  </div>
                  {remote.isMuted && (
                    <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'rgba(0,0,0,0.6)', padding: '0.25rem', borderRadius: '50%' }}>
                      🔇
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="sidebar glass">
          <div className="tabs">
            <button
              className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              Chat
            </button>
            <button
              className={`tab-btn ${activeTab === 'playlist' ? 'active' : ''}`}
              onClick={() => setActiveTab('playlist')}
            >
              Playlist
            </button>
            <button
              className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
              onClick={() => setActiveTab('users')}
            >
              Users ({users.length})
            </button>
          </div>

          {activeTab === 'chat' ? (
            <div className="chat-section">
              <div className="messages-list">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`message ${msg.username === username ? 'own' : ''}`}>
                    <div className="message-header">
                      <span>{msg.username}</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    <div className="message-content">{msg.text}</div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={handleSendMessage} className="chat-form">
                <input
                  type="text"
                  className="input"
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                />
                <button type="submit" className="btn btn-primary">Send</button>
              </form>
            </div>
          ) : activeTab === 'playlist' ? (
            <div className="playlist-section">
              <form onSubmit={handleAddVideo} className="add-video-form">
                <input
                  type="text"
                  className="input"
                  placeholder="Paste video URL"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                />
                <button type="submit" className="btn btn-primary">+ Add</button>
              </form>
              <div className="playlist-items">
                {playlist.map((url, idx) => (
                  <div
                    key={idx}
                    className={`playlist-item ${idx === currentIndex ? 'active' : ''}`}
                  >
                    <div className="playlist-item-info" onClick={() => handleChangeVideo(idx)} style={{ flex: 1, cursor: 'pointer' }}>
                      <span className="playlist-number">{idx + 1}</span>
                      <div style={{ overflow: 'hidden' }}>
                        <div className="playlist-url" title={url}>{url}</div>
                        {idx === currentIndex && <div className="now-playing">Now Playing</div>}
                      </div>
                    </div>
                    <button
                      className="btn-icon"
                      onClick={(e) => handleRemoveVideo(e, idx)}
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.25rem', marginLeft: '0.5rem' }}
                      title="Remove video"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {playlist.length === 0 && (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
                    Playlist is empty
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="users-section">
              <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', padding: '0.75rem', paddingBottom: '0', color: 'var(--text-muted)' }}>Connected Users</h3>

              {socket.id === adminId && (
                <div className="admin-controls">
                  <div style={{ fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#fbbf24' }}>👑 Admin Controls</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input
                      type="checkbox"
                      checked={permissions === 'restricted'}
                      onChange={() => socket.emit('toggle_permissions', { roomId: roomIdRef.current })}
                    />
                    Restrict Controls
                  </label>
                  <div style={{ fontSize: '0.7rem', color: '#aaa', marginTop: '0.25rem', paddingLeft: '1.5rem' }}>
                    Only admin can play/pause/add videos
                  </div>
                </div>
              )}

              <div className="users-list">
                {users.map((user, idx) => (
                  <div key={idx} className="user-item" style={{
                    padding: '0.75rem',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <div className="user-avatar" style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: 'var(--gradient-main)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      fontSize: '0.8rem'
                    }}>
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ flex: 1 }}>{user.username} {user.username === username && '(You)'}</span>
                    {user.id === adminId && <span title="Admin" style={{ fontSize: '1.2rem' }}>👑</span>}
                    {socket.id === adminId && user.id !== socket.id && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Kick ${user.username}?`)) {
                            socket.emit('kick_user', { roomId: roomIdRef.current, targetId: user.id });
                          }
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}
                        title="Kick User"
                      >
                        👢
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </main>
      {maximizedVideo && (
        <div className="maximized-overlay" style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <button onClick={() => setMaximizedVideo(null)} style={{
            position: 'absolute', top: '1rem', right: '1rem',
            background: 'rgba(255,255,255,0.2)', color: 'white', border: 'none',
            fontSize: '2rem', cursor: 'pointer', borderRadius: '50%', width: '50px', height: '50px',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>✕</button>

          <div style={{ width: '90%', height: '90%', position: 'relative' }}>
            {maximizedVideo.isLocal ? (
              <video
                ref={(el) => {
                  if (el) el.srcObject = maximizedVideo.stream;
                }}
                autoPlay playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'contain', transform: isScreenSharing ? 'none' : 'scaleX(-1)' }}
              />
            ) : (
              <VideoPlayer stream={maximizedVideo.stream} />
            )}
            <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', background: 'rgba(0,0,0,0.6)', padding: '0.5rem 1rem', borderRadius: '0.5rem', color: 'white', fontSize: '1.5rem' }}>
              {maximizedVideo.username}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
