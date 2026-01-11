import React, { useEffect, useRef, useState } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

/**
 * VideoJsPlayer Component
 * A wrapper around Video.js player with sync capabilities for Watch Party
 * 
 * Features:
 * - HLS/DASH/MP4 playback
 * - Quality selection for adaptive streams
 * - Subtitle/caption support
 * - Sync events for Watch Party coordination
 * - Custom styling to match the app theme
 */
const VideoJsPlayer = ({
    src,
    type,
    isHLS = false,
    onPlay,
    onPause,
    onSeeked,
    onReady,
    onError,
    playerRef: externalPlayerRef,
    isSyncing = false,
    subtitleUrl,
}) => {
    const videoContainerRef = useRef(null);
    const playerRef = useRef(null);
    const [qualityLevels, setQualityLevels] = useState([]);
    const [currentQuality, setCurrentQuality] = useState('auto');
    const [showQualityMenu, setShowQualityMenu] = useState(false);
    const isSyncingRef = useRef(false);

    // Keep isSyncing ref in sync with prop
    useEffect(() => {
        isSyncingRef.current = isSyncing;
    }, [isSyncing]);

    // Initialize Video.js player
    useEffect(() => {
        if (!src || !videoContainerRef.current) return;

        // Determine source type
        let sourceType = type || 'video/mp4';
        if (!type) {
            if (isHLS || src.includes('.m3u8')) {
                sourceType = 'application/x-mpegURL';
            } else if (src.includes('.mpd')) {
                sourceType = 'application/dash+xml';
            } else if (src.includes('.webm')) {
                sourceType = 'video/webm';
            } else if (src.includes('/api/proxy-video')) {
                // Proxied video is always remuxed to MP4
                sourceType = 'video/mp4';
            } else if (src.includes('.mkv')) {
                // MKV isn't natively supported, but we can try (or better yet, prevent this logic if we have proxy)
                sourceType = 'video/x-matroska';
            }
        }

        // Create video element
        const videoElement = document.createElement('video');
        videoElement.className = 'video-js vjs-big-play-centered vjs-theme-watch-party';
        videoContainerRef.current.appendChild(videoElement);

        // Initialize player
        const player = videojs(videoElement, {
            controls: true,
            autoplay: false,
            preload: 'auto',
            fluid: true,
            responsive: true,
            playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
            html5: {
                vhs: {
                    overrideNative: true,
                    enableLowInitialPlaylist: true,
                    smoothQualityChange: true,
                    allowSeeksWithinUnsafeLiveWindow: true,
                },
                nativeAudioTracks: false,
                nativeVideoTracks: false,
            },
            sources: [{
                src: src,
                type: sourceType,
            }],
        });

        playerRef.current = player;

        // Expose player through external ref
        if (externalPlayerRef) {
            externalPlayerRef.current = player;
        }

        // Player ready event
        player.ready(() => {
            console.log('Video.js player ready');

            // Add subtitle track if provided
            if (subtitleUrl) {
                player.addRemoteTextTrack({
                    kind: 'subtitles',
                    src: subtitleUrl,
                    srclang: 'en',
                    label: 'Subtitles',
                    default: true,
                }, false);
            }

            // Get quality levels for HLS streams
            const qualityLevelsPlugin = player.qualityLevels?.();
            if (qualityLevelsPlugin) {
                qualityLevelsPlugin.on('addqualitylevel', () => {
                    const levels = [];
                    for (let i = 0; i < qualityLevelsPlugin.length; i++) {
                        const level = qualityLevelsPlugin[i];
                        levels.push({
                            index: i,
                            height: level.height,
                            bitrate: level.bitrate,
                            enabled: level.enabled,
                        });
                    }
                    // Sort by height descending
                    levels.sort((a, b) => (b.height || 0) - (a.height || 0));
                    setQualityLevels(levels);
                });
            }

            onReady?.(player);
        });

        // Sync events - only emit if not syncing from another user
        player.on('play', () => {
            if (!isSyncingRef.current) {
                onPlay?.(player.currentTime());
            }
        });

        player.on('pause', () => {
            if (!isSyncingRef.current) {
                onPause?.(player.currentTime());
            }
        });

        player.on('seeked', () => {
            if (!isSyncingRef.current) {
                onSeeked?.(player.currentTime());
            }
        });

        player.on('error', (e) => {
            console.error('Video.js error:', player.error());
            onError?.(player.error());
        });

        // Cleanup
        return () => {
            if (player && !player.isDisposed()) {
                player.dispose();
                playerRef.current = null;
                if (externalPlayerRef) {
                    externalPlayerRef.current = null;
                }
            }
        };
    }, [src]); // Only reinitialize when src changes

    // Update subtitle track when URL changes
    useEffect(() => {
        const player = playerRef.current;
        if (!player || player.isDisposed()) return;

        // Remove existing text tracks
        const tracks = player.remoteTextTracks();
        for (let i = tracks.length - 1; i >= 0; i--) {
            player.removeRemoteTextTrack(tracks[i]);
        }

        // Add new subtitle track
        if (subtitleUrl) {
            player.addRemoteTextTrack({
                kind: 'subtitles',
                src: subtitleUrl,
                srclang: 'en',
                label: 'Subtitles',
                default: true,
            }, false);
        }
    }, [subtitleUrl]);

    // Handle quality change
    const handleQualityChange = (index) => {
        const player = playerRef.current;
        if (!player || player.isDisposed()) return;

        const qualityLevelsPlugin = player.qualityLevels?.();
        if (!qualityLevelsPlugin) return;

        if (index === 'auto') {
            // Enable all levels for ABR
            for (let i = 0; i < qualityLevelsPlugin.length; i++) {
                qualityLevelsPlugin[i].enabled = true;
            }
            setCurrentQuality('auto');
        } else {
            // Disable all except selected
            for (let i = 0; i < qualityLevelsPlugin.length; i++) {
                qualityLevelsPlugin[i].enabled = (i === index);
            }
            setCurrentQuality(index);
        }
        setShowQualityMenu(false);
    };

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {/* Video.js container */}
            <div
                ref={videoContainerRef}
                style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#000',
                }}
            />

            {/* Quality selector (for HLS streams) */}
            {qualityLevels.length > 1 && (
                <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 20 }}>
                    <button
                        onClick={() => setShowQualityMenu(!showQualityMenu)}
                        style={{
                            background: 'rgba(0,0,0,0.7)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '6px 12px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                        }}
                    >
                        ⚙️ {currentQuality === 'auto' ? 'Auto' : `${qualityLevels.find(q => q.index === currentQuality)?.height}p`}
                    </button>

                    {showQualityMenu && (
                        <div
                            style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                marginTop: '4px',
                                background: 'rgba(0,0,0,0.9)',
                                borderRadius: '6px',
                                overflow: 'hidden',
                                minWidth: '120px',
                            }}
                        >
                            <button
                                onClick={() => handleQualityChange('auto')}
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    padding: '8px 12px',
                                    background: currentQuality === 'auto' ? 'rgba(99, 102, 241, 0.5)' : 'transparent',
                                    color: 'white',
                                    border: 'none',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    fontSize: '0.85rem',
                                }}
                            >
                                {currentQuality === 'auto' && '✓ '}Auto
                            </button>
                            {qualityLevels.map((level) => (
                                <button
                                    key={level.index}
                                    onClick={() => handleQualityChange(level.index)}
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        padding: '8px 12px',
                                        background: currentQuality === level.index ? 'rgba(99, 102, 241, 0.5)' : 'transparent',
                                        color: 'white',
                                        border: 'none',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontSize: '0.85rem',
                                    }}
                                >
                                    {currentQuality === level.index && '✓ '}{level.height}p
                                    <span style={{ color: '#888', fontSize: '0.75rem', marginLeft: '8px' }}>
                                        {level.bitrate ? `${Math.round(level.bitrate / 1000)}kbps` : ''}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default VideoJsPlayer;
