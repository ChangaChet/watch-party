import React, { useEffect, useRef } from 'react';

const EmbedPlayer = ({ videoId, socket, roomId }) => {
    const iframeRef = useRef(null);

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
        // Listen for Mapple Player events (logging/debug)
        const handleIframeMessage = (event) => {
            if (!event.origin.includes('mapple.uk')) return;

            const { type, data } = event.data;

            if (type === 'PLAYER_EVENT') {
                console.log('Mapple Event:', data.event, data.currentTime);
            }
            if (type === 'WATCH_PARTY') {
                console.log('Mapple Watch Party initialized:', data);
            }
        };

        window.addEventListener('message', handleIframeMessage);
        return () => window.removeEventListener('message', handleIframeMessage);
    }, []);

    // NOTE: Manual socket sync is disabled because MappleTV handles sync internally 
    // via the 'partyId' parameter in the URL.

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
