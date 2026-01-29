import React, { useEffect, useRef, useState } from 'react';

const EmbedPlayer = ({ videoId, socket, roomId }) => {
    const iframeRef = useRef(null);
    const isSyncingRef = useRef(false);
    const embedUrl = React.useMemo(() => {
        if (!videoId) return '';

        const parseVideoInput = (input) => {
            // Base params: autoPlay is essential for programmatic control
            // We DO NOT send watchParty=true here because App.jsx handles the sync logic.
            const params = `?autoPlay=true&title=true&poster=true`;

            // 1. Check for TV Show pattern: "tt12345 s1 e1" or "tt12345-1-1"
            // Regex matches: (ID) ... s(Season) ... e(Episode)
            const tvMatch = input.match(/(tt\d+|tmdb\d+).*?s(\d+).*?e(\d+)/i);

            if (tvMatch) {
                const [, id, season, episode] = tvMatch;
                return `https://mapple.uk/watch/tv/${id}-${season}-${episode}${params}`;
            }

            // 2. Default to Movie
            // Extract clean ID (tt12345 or 12345)
            const cleanId = input.includes('imdb.com') || input.includes('tt')
                ? (input.match(/tt\d+/) || [input])[0]
                : input;

            return `https://mapple.uk/watch/movie/${cleanId}${params}`;
        };

        return parseVideoInput(videoId);
    }, [videoId]);

    // --- SOCKET SYNC (INCOMING) ---
    // Listen for commands from the Server/Admin to control the iframe
    useEffect(() => {
        if (!socket || !iframeRef.current) return;

        const sendToPlayer = (type, data) => {
            if (iframeRef.current && iframeRef.current.contentWindow) {
                isSyncingRef.current = true;
                iframeRef.current.contentWindow.postMessage({ type, currentTime: data.currentTime }, '*');
                // Debounce the sync flag to prevent echo
                setTimeout(() => { isSyncingRef.current = false; }, 1000);
            }
        };

        const onSyncPlay = (data) => sendToPlayer('play', data);
        const onSyncPause = (data) => sendToPlayer('pause', data);
        const onSyncSeek = (data) => sendToPlayer('seek', data);

        socket.on('sync_play', onSyncPlay);
        socket.on('sync_pause', onSyncPause);
        socket.on('sync_seek', onSyncSeek);

        return () => {
            socket.off('sync_play', onSyncPlay);
            socket.off('sync_pause', onSyncPause);
            socket.off('sync_seek', onSyncSeek);
        };
    }, [socket]);

    // --- IFRAME EVENTS (OUTGOING) ---
    // Listen for events from Mapple Player and notify the Server
    useEffect(() => {
        const handleIframeMessage = (event) => {
            // Strict Origin Check as per Documentation
            if (event.origin !== 'https://mapple.uk') return;

            const { type, data } = event.data;
            if (!data) return;

            // 1. Handle Playback Events
            if (type === 'PLAYER_EVENT') {
                // Ignore events caused by our own sync actions to prevent loops
                if (isSyncingRef.current) return;

                const { event: playerEvent, currentTime } = data;

                if (playerEvent === 'play' || playerEvent === 'playing') {
                    socket.emit('sync_action', { roomId, action: 'play', data: { currentTime } });
                } else if (playerEvent === 'pause') {
                    socket.emit('sync_action', { roomId, action: 'pause', data: { currentTime } });
                } else if (playerEvent === 'seeked') {
                    socket.emit('sync_action', { roomId, action: 'seek', data: { currentTime } });
                }
            }

            // 2. Handle Media Data (Optional: store progress or title)
            if (type === 'MEDIA_DATA') {
                console.log('Currently Playing:', data.title);
                // You could emit this to the room to update the "Now Playing" title
                // socket.emit('update_media_info', { roomId, title: data.title });
            }
        };

        window.addEventListener('message', handleIframeMessage);
        return () => window.removeEventListener('message', handleIframeMessage);
    }, [roomId, socket]);

    return (
        <div className="embed-player-wrapper" style={{ width: '100%', height: '100%', backgroundColor: '#000' }}>
            {embedUrl ? (
                <iframe
                    ref={iframeRef}
                    src={embedUrl}
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    allowFullScreen
                    // Critical: allow="encrypted-media" is required for playback
                    allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                    style={{ width: '100%', height: '100%', border: 'none' }}
                />
            ) : (
                <div style={{ color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    Loading Player...
                </div>
            )}
        </div>
    );
};

export default EmbedPlayer;