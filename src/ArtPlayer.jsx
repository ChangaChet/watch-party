import React, { useEffect, useRef } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';

/**
 * ArtPlayer Component
 * A wrapper around ArtPlayer.js with sync capabilities for Watch Party
 * 
 * Features:
 * - HLS/DASH/MP4 playback via hls.js
 * - Quality selection for adaptive streams
 * - Subtitle/caption support
 * - Sync events for Watch Party coordination
 * - Modern UI with full feature set
 */
const ArtPlayerComponent = ({
    src,
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
    const artContainerRef = useRef(null);
    const artRef = useRef(null);
    const hlsRef = useRef(null);
    const isSyncingRef = useRef(false);

    // Keep isSyncing ref in sync with prop
    useEffect(() => {
        isSyncingRef.current = isSyncing;
    }, [isSyncing]);

    // Initialize ArtPlayer
    useEffect(() => {
        if (!src || !artContainerRef.current) return;

        // Determine if HLS
        const isHlsStream = isHLS || src.includes('.m3u8');

        // Custom HLS setup function for ArtPlayer
        const playM3u8 = (video, url, art) => {
            if (Hls.isSupported()) {
                if (hlsRef.current) {
                    hlsRef.current.destroy();
                }
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                });
                hls.loadSource(url);
                hls.attachMedia(video);
                hlsRef.current = hls;

                // Quality control - expose levels to ArtPlayer
                hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                    const qualities = data.levels.map((level, index) => ({
                        html: `${level.height}p`,
                        value: index,
                    }));

                    // Add auto option
                    qualities.unshift({
                        html: 'Auto',
                        value: -1,
                        default: true,
                    });

                    art.setting.update({
                        name: 'quality',
                        selector: qualities,
                        onSelect: (item) => {
                            if (item.value === -1) {
                                hls.currentLevel = -1; // Auto
                            } else {
                                hls.currentLevel = item.value;
                            }
                            return item.html;
                        },
                    });
                });

                hls.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        console.error('HLS Fatal Error:', data);
                        onError?.(data);
                    }
                });

                art.hls = hls;
                art.on('destroy', () => hls.destroy());
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                // Native HLS support (Safari)
                video.src = url;
            } else {
                art.notice.show = 'HLS is not supported in this browser';
                onError?.({ message: 'HLS not supported' });
            }
        };

        // Build subtitle array if provided
        const subtitles = subtitleUrl ? [{
            url: subtitleUrl,
            type: 'vtt',
            encoding: 'utf-8',
            default: true,
            name: 'Subtitles',
        }] : [];

        // Initialize ArtPlayer
        const art = new Artplayer({
            container: artContainerRef.current,
            url: src,
            type: isHlsStream ? 'm3u8' : undefined,
            customType: isHlsStream ? {
                m3u8: playM3u8,
            } : undefined,
            volume: 0.7,
            isLive: false,
            muted: false,
            autoplay: false,
            pip: true,
            autoSize: false,
            autoMini: true,
            screenshot: true,
            setting: true,
            loop: false,
            flip: true,
            playbackRate: true,
            aspectRatio: true,
            fullscreen: true,
            fullscreenWeb: true,
            subtitleOffset: true,
            miniProgressBar: true,
            mutex: true,
            backdrop: true,
            playsInline: true,
            autoPlayback: true,
            airplay: true,
            theme: '#6366f1', // Indigo to match app theme
            subtitle: subtitles.length > 0 ? subtitles[0] : undefined,
            settings: [
                {
                    name: 'quality',
                    html: 'Quality',
                    tooltip: 'Auto',
                    selector: [],
                },
            ],
            icons: {
                loading: '<div class="art-loading-icon"></div>',
            },
        });

        artRef.current = art;

        // Expose player through external ref
        if (externalPlayerRef) {
            // Create a compatible interface
            externalPlayerRef.current = {
                currentTime: () => art.currentTime,
                play: () => art.play(),
                pause: () => art.pause(),
                paused: () => !art.playing,
                seek: (time) => { art.currentTime = time; },
                // Video.js compatibility layer
                isDisposed: () => !artRef.current,
            };
        }

        // Player ready event
        art.on('ready', () => {
            console.log('ArtPlayer ready');
            onReady?.(externalPlayerRef?.current || art);
        });

        // Sync events - only emit if not syncing from another user
        art.on('play', () => {
            if (!isSyncingRef.current) {
                onPlay?.(art.currentTime);
            }
        });

        art.on('pause', () => {
            if (!isSyncingRef.current) {
                onPause?.(art.currentTime);
            }
        });

        art.on('seek', () => {
            if (!isSyncingRef.current) {
                onSeeked?.(art.currentTime);
            }
        });

        art.on('error', (error) => {
            console.error('ArtPlayer error:', error);
            onError?.(error);
        });

        // Cleanup
        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            if (art && art.destroy) {
                art.destroy(false);
            }
            artRef.current = null;
            if (externalPlayerRef) {
                externalPlayerRef.current = null;
            }
        };
    }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

    // Update subtitle when URL changes
    useEffect(() => {
        const art = artRef.current;
        if (!art) return;

        if (subtitleUrl) {
            art.subtitle.switch(subtitleUrl, { name: 'Subtitles' });
        }
    }, [subtitleUrl]);

    return (
        <div
            ref={artContainerRef}
            style={{
                width: '100%',
                height: '100%',
                backgroundColor: '#000',
            }}
        />
    );
};

export default ArtPlayerComponent;
