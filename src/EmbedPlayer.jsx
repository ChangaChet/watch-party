import React, { useEffect, useRef } from 'react';

const EmbedPlayer = ({ videoId, socket, roomId }) => {
    const iframeRef = useRef(null);
    const isSyncingRef = useRef(false);

    // Parse input for TV Show format (e.g., "tt12345 s1 e1") or default to Movie
    const parseVideoInput = (input) => {
        // Base params for Watch Party
        const params = `?watchParty=true&autoPlay=true&partyId=${roomId}`;

        // Try to match "tt..." then "s..." then "e..."
        const tvMatch = input.match(/(tt\d+).*?s(\d+).*?e(\d+)/i);

        if (tvMatch) {
            const [, id, season, episode] = tvMatch;
            return `https://mapple.uk/watch/tv/${id}-${season}-${episode}${params}`;
        }

        // Default to Movie
        const cleanId = input.includes('imdb.com') || input.includes('tt')
            ? (input.match(/tt\d+/) || [input])[0]
            : input;

        return `https://mapple.uk/watch/movie/${cleanId}${params}`;
    };

    const embedUrl = parseVideoInput(videoId);

    useEffect(() => {
        // Listen for Mapple Player events
        const handleIframeMessage = (event) => {
            if (!event.origin.includes('mapple.uk')) return;

            const { type, data } = event.data;

            if (type === 'PLAYER_EVENT') {
                console.log('Mapple Event:', data.event, data.currentTime);

                // If we are currently processing a sync action from the socket, ignore this event
                if (isSyncingRef.current) return;

                // Map Mapple events to socket sync actions
                if (data.event === 'play' || data.event === 'playing') {
                    socket.emit('sync_action', {
                        roomId,
                        action: 'play',
                        data: { currentTime: data.currentTime }
                    });
                } else if (data.event === 'pause') {
                    socket.emit('sync_action', {
                        roomId,
                        action: 'pause',
                        data: { currentTime: data.currentTime }
                    });
                } else if (data.event === 'seeked') {
                    socket.emit('sync_action', {
                        roomId,
                        action: 'seek',
                        data: { currentTime: data.currentTime }
                    });
                }
            }
            if (type === 'WATCH_PARTY') {
                console.log('Mapple Watch Party initialized:', data);
            }
        };

        window.addEventListener('message', handleIframeMessage);
        return () => window.removeEventListener('message', handleIframeMessage);
    }, [roomId, socket]);

    // Manual Socket Sync Implementation
    useEffect(() => {
        if (!socket) return;

        const onSyncPlay = (data) => {
            if (!iframeRef.current) return;
            isSyncingRef.current = true;
            // Attempt to control Mapple Player via postMessage
            iframeRef.current.contentWindow.postMessage({ type: 'play', currentTime: data.currentTime }, '*');
            setTimeout(() => { isSyncingRef.current = false; }, 1000);
        };

        const onSyncPause = (data) => {
            if (!iframeRef.current) return;
            isSyncingRef.current = true;
            iframeRef.current.contentWindow.postMessage({ type: 'pause', currentTime: data.currentTime }, '*');
            setTimeout(() => { isSyncingRef.current = false; }, 1000);
        };

        const onSyncSeek = (data) => {
            if (!iframeRef.current) return;
            isSyncingRef.current = true;
            iframeRef.current.contentWindow.postMessage({ type: 'seek', currentTime: data.currentTime }, '*');
            setTimeout(() => { isSyncingRef.current = false; }, 1000);
        };

        socket.on('sync_play', onSyncPlay);
        socket.on('sync_pause', onSyncPause);
        socket.on('sync_seek', onSyncSeek);

        // Also handle sync_receive (legacy?) or just standard sync_action events
        // Server emits 'sync_play', 'sync_pause', 'sync_seek' based on 'sync_action'

        return () => {
            socket.off('sync_play', onSyncPlay);
            socket.off('sync_pause', onSyncPause);
            socket.off('sync_seek', onSyncSeek);
        };
    }, [socket]);


    return (
        <div className="embed-player-wrapper" style={{ width: '100%', height: '100%', backgroundColor: '#000' }}>
            <iframe
                ref={iframeRef}
                src={embedUrl}
                width="100%"
                height="100%"
                frameBorder="0"
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{ width: '100%', height: '100%', border: 'none' }}
            />
        </div>
    );
};

export default EmbedPlayer;
