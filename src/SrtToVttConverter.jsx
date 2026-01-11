import React, { useState, useRef } from 'react';
import JSZip from 'jszip';

/**
 * Converts SRT subtitle format to VTT format
 * @param {string} srtContent - The SRT file content
 * @returns {string} - The converted VTT content
 */
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

/**
 * Downloads a file with the given content
 * @param {string} content - File content
 * @param {string} filename - Name of the file to download
 * @param {string} mimeType - MIME type of the file
 */
const downloadFile = (content, filename, mimeType = 'text/vtt') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

const SrtToVttConverter = ({ onClose }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [results, setResults] = useState([]);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);

    const processFiles = async (files) => {
        setIsProcessing(true);
        setError(null);
        setResults([]);

        const processedResults = [];

        try {
            for (const file of files) {
                const fileName = file.name.toLowerCase();

                if (fileName.endsWith('.zip')) {
                    // Process ZIP file
                    const zip = new JSZip();
                    const zipContent = await file.arrayBuffer();
                    const loadedZip = await zip.loadAsync(zipContent);

                    const srtFiles = [];
                    loadedZip.forEach((relativePath, zipEntry) => {
                        if (!zipEntry.dir && relativePath.toLowerCase().endsWith('.srt')) {
                            srtFiles.push({ path: relativePath, entry: zipEntry });
                        }
                    });

                    if (srtFiles.length === 0) {
                        processedResults.push({
                            fileName: file.name,
                            status: 'error',
                            message: 'No SRT files found in ZIP'
                        });
                        continue;
                    }

                    // Create a new ZIP for converted VTT files
                    const outputZip = new JSZip();

                    for (const srtFile of srtFiles) {
                        const content = await srtFile.entry.async('string');
                        const vttContent = convertSrtToVtt(content);
                        const vttPath = srtFile.path.replace(/\.srt$/i, '.vtt');
                        outputZip.file(vttPath, vttContent);
                    }

                    const outputBlob = await outputZip.generateAsync({ type: 'blob' });
                    const outputFileName = file.name.replace(/\.zip$/i, '_converted.zip');

                    processedResults.push({
                        fileName: file.name,
                        status: 'success',
                        message: `Converted ${srtFiles.length} SRT file(s)`,
                        outputFileName,
                        blob: outputBlob,
                        count: srtFiles.length
                    });

                } else if (fileName.endsWith('.srt')) {
                    // Process single SRT file
                    const content = await file.text();
                    const vttContent = convertSrtToVtt(content);
                    const outputFileName = file.name.replace(/\.srt$/i, '.vtt');

                    processedResults.push({
                        fileName: file.name,
                        status: 'success',
                        message: 'Converted successfully',
                        outputFileName,
                        content: vttContent
                    });

                } else {
                    processedResults.push({
                        fileName: file.name,
                        status: 'error',
                        message: 'Unsupported file type. Please upload .srt or .zip files only.'
                    });
                }
            }

            setResults(processedResults);

            // Auto-download if single file
            if (processedResults.length === 1 && processedResults[0].status === 'success') {
                const result = processedResults[0];
                if (result.blob) {
                    downloadFile(result.blob, result.outputFileName, 'application/zip');
                } else if (result.content) {
                    downloadFile(result.content, result.outputFileName, 'text/vtt');
                }
            }

        } catch (err) {
            console.error('Error processing files:', err);
            setError(`Error processing files: ${err.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            processFiles(files);
        }
        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            processFiles(files);
        }
    };

    const handleDownload = (result) => {
        if (result.blob) {
            downloadFile(result.blob, result.outputFileName, 'application/zip');
        } else if (result.content) {
            downloadFile(result.content, result.outputFileName, 'text/vtt');
        }
    };

    return (
        <div className="converter-overlay">
            <div className="converter-modal glass">
                <div className="converter-header">
                    <h2 className="gradient-text">SRT to VTT Converter</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>

                <p className="converter-description">
                    Convert your SRT subtitles to VTT format for web video players.
                    <br />
                    <span className="converter-hint">Supports single .srt files or .zip archives with multiple SRT files</span>
                </p>

                <div
                    className={`drop-zone ${isDragging ? 'dragging' : ''} ${isProcessing ? 'processing' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => !isProcessing && fileInputRef.current?.click()}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".srt,.zip"
                        multiple
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                    />

                    {isProcessing ? (
                        <div className="processing-indicator">
                            <div className="spinner"></div>
                            <span>Converting...</span>
                        </div>
                    ) : (
                        <>
                            <div className="drop-icon">📁</div>
                            <div className="drop-text">
                                <strong>Drop files here</strong>
                                <span>or click to browse</span>
                            </div>
                            <div className="supported-formats">
                                .srt or .zip files
                            </div>
                        </>
                    )}
                </div>

                {error && (
                    <div className="converter-error">
                        <span>⚠️</span> {error}
                    </div>
                )}

                {results.length > 0 && (
                    <div className="results-section">
                        <h3>Results</h3>
                        <div className="results-list">
                            {results.map((result, index) => (
                                <div key={index} className={`result-item ${result.status}`}>
                                    <div className="result-info">
                                        <span className="result-icon">
                                            {result.status === 'success' ? '✓' : '✕'}
                                        </span>
                                        <div className="result-details">
                                            <div className="result-filename">{result.fileName}</div>
                                            <div className="result-message">{result.message}</div>
                                        </div>
                                    </div>
                                    {result.status === 'success' && (
                                        <button
                                            className="download-btn"
                                            onClick={() => handleDownload(result)}
                                        >
                                            ⬇ Download
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="converter-footer">
                    <div className="converter-tips">
                        <strong>💡 Tips:</strong>
                        <ul>
                            <li>VTT format is required for HTML5 video subtitles</li>
                            <li>Converted files preserve all timing and text</li>
                            <li>ZIP files will output a ZIP with converted VTT files</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SrtToVttConverter;
