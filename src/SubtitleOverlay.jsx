import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * SubtitleOverlay Component
 * Renders SRT/VTT subtitles as an overlay on top of the video
 * with adjustable sync delay, font size, and positioning
 */
const SubtitleOverlay = ({
    videoRef,
    subtitleContent,
    delay = 0,
    fontSize = 24,
    fontColor = '#ffffff',
    backgroundColor = 'rgba(0, 0, 0, 0.75)',
    position = 'bottom', // 'top' or 'bottom'
    enabled = true
}) => {
    const [currentSubtitle, setCurrentSubtitle] = useState('');
    const [parsedCues, setParsedCues] = useState([]);
    const animationFrameRef = useRef(null);

    // Parse SRT format
    const parseSRT = useCallback((content) => {
        const cues = [];
        const blocks = content.trim().split(/\n\n+/);

        for (const block of blocks) {
            const lines = block.split('\n');
            if (lines.length < 2) continue;

            // Find the timing line (contains -->)
            let timingLineIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) {
                    timingLineIndex = i;
                    break;
                }
            }

            if (timingLineIndex === -1) continue;

            const timingLine = lines[timingLineIndex];
            const match = timingLine.match(/(\d{1,2}:\d{2}:\d{2}[,.:]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.:]\d{1,3})/);

            if (!match) continue;

            const startTime = parseTime(match[1]);
            const endTime = parseTime(match[2]);

            // Text is everything after the timing line
            const text = lines.slice(timingLineIndex + 1).join('\n').trim();

            if (text) {
                cues.push({ startTime, endTime, text });
            }
        }

        return cues;
    }, []);

    // Parse VTT format
    const parseVTT = useCallback((content) => {
        const cues = [];
        // Remove WEBVTT header and metadata
        const lines = content.split('\n');
        let i = 0;

        // Skip header
        while (i < lines.length && !lines[i].includes('-->')) {
            i++;
        }

        while (i < lines.length) {
            const line = lines[i].trim();

            if (line.includes('-->')) {
                const match = line.match(/(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})/);

                if (match) {
                    const startTime = parseTime(match[1]);
                    const endTime = parseTime(match[2]);

                    // Collect text lines until empty line or next cue
                    const textLines = [];
                    i++;
                    while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
                        textLines.push(lines[i]);
                        i++;
                    }

                    const text = textLines.join('\n').trim();
                    if (text) {
                        cues.push({ startTime, endTime, text });
                    }
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }

        return cues;
    }, []);

    // Parse time string to seconds
    const parseTime = (timeStr) => {
        // Handle either , or . as decimal separator
        const normalized = timeStr.replace(',', '.').replace(':', ':',);
        const parts = normalized.split(':');

        if (parts.length === 3) {
            // HH:MM:SS.mmm
            const [hours, minutes, secondsMs] = parts;
            const [seconds, ms] = secondsMs.split('.');
            return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + (parseInt(ms || 0) / 1000);
        } else if (parts.length === 2) {
            // MM:SS.mmm
            const [minutes, secondsMs] = parts;
            const [seconds, ms] = secondsMs.split('.');
            return parseInt(minutes) * 60 + parseInt(seconds) + (parseInt(ms || 0) / 1000);
        }

        return 0;
    };

    // Parse subtitle content when it changes
    useEffect(() => {
        if (!subtitleContent) {
            setParsedCues([]);
            return;
        }

        let cues;
        if (subtitleContent.trim().startsWith('WEBVTT')) {
            cues = parseVTT(subtitleContent);
        } else {
            cues = parseSRT(subtitleContent);
        }

        console.log('Parsed subtitle cues:', cues.length);
        setParsedCues(cues);
    }, [subtitleContent, parseSRT, parseVTT]);

    // Update current subtitle based on video time
    useEffect(() => {
        if (!videoRef?.current || parsedCues.length === 0 || !enabled) {
            setCurrentSubtitle('');
            return;
        }

        const video = videoRef.current;

        const updateSubtitle = () => {
            const currentTime = video.currentTime + (delay / 1000); // delay is in ms

            // Find the current cue
            const cue = parsedCues.find(
                c => currentTime >= c.startTime && currentTime <= c.endTime
            );

            setCurrentSubtitle(cue ? cue.text : '');
            animationFrameRef.current = requestAnimationFrame(updateSubtitle);
        };

        animationFrameRef.current = requestAnimationFrame(updateSubtitle);

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [videoRef, parsedCues, delay, enabled]);

    if (!enabled || !currentSubtitle) return null;

    // Convert HTML-like tags to styled spans
    const formatSubtitle = (text) => {
        // Handle basic formatting tags
        let formatted = text
            .replace(/<b>/gi, '<strong>')
            .replace(/<\/b>/gi, '</strong>')
            .replace(/<i>/gi, '<em>')
            .replace(/<\/i>/gi, '</em>')
            .replace(/<u>/gi, '<u>')
            .replace(/<\/u>/gi, '</u>')
            .replace(/\{\\an\d+\}/g, '') // Remove positioning tags
            .replace(/<font[^>]*>/gi, '')
            .replace(/<\/font>/gi, '')
            .replace(/\n/g, '<br/>');

        return formatted;
    };

    return (
        <div
            style={{
                position: 'absolute',
                left: 0,
                right: 0,
                [position]: '5%',
                zIndex: 25,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                pointerEvents: 'none',
                padding: '0 10%',
            }}
        >
            <div
                style={{
                    backgroundColor: backgroundColor,
                    color: fontColor,
                    fontSize: `${fontSize}px`,
                    fontWeight: '500',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    textAlign: 'center',
                    maxWidth: '90%',
                    lineHeight: 1.4,
                    textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                    fontFamily: 'Arial, sans-serif',
                    whiteSpace: 'pre-wrap',
                }}
                dangerouslySetInnerHTML={{ __html: formatSubtitle(currentSubtitle) }}
            />
        </div>
    );
};

export default SubtitleOverlay;
