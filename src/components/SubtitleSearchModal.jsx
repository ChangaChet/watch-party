import React, { useState, useEffect } from 'react';
import { searchSubtitles, downloadSubtitle } from '../services/OpenSubtitles';

const SubtitleSearchModal = ({ isOpen, onClose, defaultQuery, onSelectSubtitle }) => {
    const [query, setQuery] = useState(defaultQuery || '');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [downloadingId, setDownloadingId] = useState(null);

    useEffect(() => {
        if (defaultQuery) {
            setQuery(defaultQuery);
            // Optional: Auto-search could be added here
        }
    }, [defaultQuery]);

    const handleSearch = async (e) => {
        if (e) e.preventDefault();
        if (!query.trim()) return;

        setLoading(true);
        setError(null);
        setResults([]);

        try {
            const data = await searchSubtitles(query);
            if (data.data) {
                setResults(data.data);
                if (data.data.length === 0) {
                    setError('No subtitles found.');
                }
            } else {
                setResults([]);
                setError('No results returned.');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async (downloadUrl, fileName) => {
        setDownloadingId(downloadUrl);
        setError(null);

        try {
            const data = await downloadSubtitle(downloadUrl);
            if (data.content) {
                onSelectSubtitle(data.content, fileName);
                onClose();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setDownloadingId(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="subtitle-search-modal-overlay">
            <div className="subtitle-search-modal">
                <div className="modal-header">
                    <h3>Search Subtitles (Free)</h3>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="modal-body">
                    <p style={{ fontSize: '0.85rem', color: '#aaa', marginTop: 0 }}>
                        Powered by OpenSubtitles (via Stremio APIs)
                    </p>

                    <form onSubmit={handleSearch} className="search-form">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search Movie or TV Show..."
                            className="search-input"
                            autoFocus
                        />
                        <button type="submit" className="search-btn" disabled={loading}>
                            {loading ? 'Searching...' : 'Search'}
                        </button>
                    </form>

                    {error && <div className="error-message">{error}</div>}

                    <div className="results-list">
                        {results.map((item) => (
                            <div key={item.id} className="result-item">
                                <div className="result-info">
                                    <span className="result-title">{item.attributes.feature_details.title}</span>
                                    <span className="result-meta">
                                        {item.attributes.language} • {item.attributes.files?.[0]?.file_name}
                                    </span>
                                </div>
                                <button
                                    className="download-btn"
                                    disabled={downloadingId === item.attributes.files?.[0]?.download_url}
                                    onClick={() => handleDownload(item.attributes.files?.[0]?.download_url, item.attributes.files?.[0]?.file_name)}
                                >
                                    {downloadingId === item.attributes.files?.[0]?.download_url ? 'Loading...' : 'Select'}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SubtitleSearchModal;
