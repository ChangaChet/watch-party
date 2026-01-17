/**
 * Converts SRT subtitle format to VTT format
 * @param {string} srtContent - The SRT file content
 * @returns {string} - The converted VTT content
 */
export const convertSrtToVtt = (srtContent) => {
    // Start VTT file with required header
    let vttContent = 'WEBVTT\n\n';

    // Normalize line endings
    const normalizedContent = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split by double newlines to get subtitle blocks
    const blocks = normalizedContent.split(/\n\n+/);

    for (const block of blocks) {
        if (!block.trim()) continue;

        const lines = block.split('\n');
        if (lines.length < 2) continue;

        // Find the timestamp line (contains -->)
        let timestampLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('-->')) {
                timestampLineIndex = i;
                break;
            }
        }

        if (timestampLineIndex === -1) continue;

        // Convert timestamp format from SRT (00:00:00,000) to VTT (00:00:00.000)
        let timestampLine = lines[timestampLineIndex];
        timestampLine = timestampLine.replace(/,/g, '.');

        // Get subtitle text (everything after timestamp line)
        const textLines = lines.slice(timestampLineIndex + 1);
        const text = textLines.join('\n');

        if (text.trim()) {
            vttContent += timestampLine + '\n';
            vttContent += text + '\n\n';
        }
    }

    return vttContent;
};
