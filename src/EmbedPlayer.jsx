import React, { useEffect, useRef } from 'react';

const EmbedPlayer = ({ videoId, socket, roomId }) => {
    const iframeRef = useRef(null);

    // Clean the ID (ensure no URL parts, just the ID)
    // If full URL was passed, try to extract tt ID
    const cleanId = videoId.includes('imdb.com') || videoId.includes('tt')
        ? (videoId.match(/tt\d+/) || [videoId])[0]
        : videoId;

    // Use MappleTV embed API
    const EMBED_BASE = "https://mappletv.uk/embed/movie";
    const embedUrl = `${EMBED_BASE}/${cleanId}`;

    useEffect(() => {
        // 1. Listen for events FROM the iframe (User clicked play/pause)
        const handleIframeMessage = (event) => {
            // Security check - allowing mappletv domains
            if (!event.origin.includes('mappletv.uk')) return;

            const { type, data } = event.data;
            console.log('PostMessage Received:', type, data); // Debug

            // Map iframe events to socket actions
            if (type === 'media.play') {
                socket.emit('sync_action', { roomId, action: 'play', data: { currentTime: data?.currentTime } });
            }
            if (type === 'media.pause') {
                socket.emit('sync_action', { roomId, action: 'pause', data: { currentTime: data?.currentTime } });
            }
            if (type === 'media.seek') {
                socket.emit('sync_action', { roomId, action: 'seek', data: { currentTime: data?.currentTime } });
            }
        };

        window.addEventListener('message', handleIframeMessage);
        return () => window.removeEventListener('message', handleIframeMessage);
    }, [socket, roomId]);

    useEffect(() => {
        if (!socket) return;
        // 2. Listen for events FROM the Socket (Friend clicked play/pause)
        const sendCommand = (action, value) => {
            if (iframeRef.current?.contentWindow) {
                // MappleTV specific command structure might vary, adapting standard postMessage pattern
                iframeRef.current.contentWindow.postMessage({ type: action, value }, '*');
            }
        };

        const handleSync = (data) => { console.log('Sync Event:', data); };

        socket.on('sync_play', (data) => {
            sendCommand('seek', data.currentTime);
            sendCommand('play');
        });
        socket.on('sync_pause', (data) => {
            sendCommand('pause');
            sendCommand('seek', data.currentTime);
        });
        socket.on('sync_seek', (data) => sendCommand('seek', data.currentTime));

        return () => {
            socket.off('sync_play');
            socket.off('sync_pause');
            socket.off('sync_seek');
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
