import React, { useState, useEffect, useRef } from 'react';

const MovieSearchModal = ({ isOpen, onClose, onSelect }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const inputRef = useRef(null);
    const debounceTimeout = useRef(null);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const searchMovies = async (searchQuery) => {
        if (!searchQuery || searchQuery.length < 2) {
            setResults([]);
            return;
        }

        setIsLoading(true);
        try {
            const baseUrl = import.meta.env.PROD ? '' : 'http://localhost:3001';
            const res = await fetch(`${baseUrl}/api/imdb-search?q=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();

            if (data && data.d) {
                // Filter mainly for movies/series
                setResults(data.d.filter(item => item.id && item.l));
            }
        } catch (error) {
            console.error('Search error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleInput = (e) => {
        const val = e.target.value;
        setQuery(val);

        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

        debounceTimeout.current = setTimeout(() => {
            searchMovies(val);
        }, 500);
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content glass" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', width: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                <h3 style={{ marginBottom: '1rem', color: '#fff' }}>Search Movies & TV</h3>

                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={handleInput}
                    placeholder="Type movie name (e.g. Matrix)..."
                    className="glass-input"
                    style={{ width: '100%', marginBottom: '1rem', padding: '12px' }}
                />

                <div className="search-results" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {isLoading && <div style={{ color: '#aaa', textAlign: 'center' }}>Searching...</div>}

                    {!isLoading && results.length === 0 && query.length > 2 && (
                        <div style={{ color: '#aaa', textAlign: 'center' }}>No results found</div>
                    )}

                    {results.map((item) => (
                        <div
                            key={item.id}
                            onClick={() => {
                                onSelect(item.id); // Pass the IMDB ID (tt...)
                                onClose();
                            }}
                            className="search-result-item"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '10px',
                                background: 'rgba(255,255,255,0.05)',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                transition: 'background 0.2s',
                                gap: '12px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        >
                            {item.i ? (
                                <img
                                    src={item.i.imageUrl}
                                    alt={item.l}
                                    style={{ width: '40px', height: '60px', objectFit: 'cover', borderRadius: '4px' }}
                                />
                            ) : (
                                <div style={{ width: '40px', height: '60px', background: '#333', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>🎬</div>
                            )}

                            <div style={{ flex: 1 }}>
                                <div style={{ color: 'white', fontWeight: 'bold' }}>{item.l}</div>
                                <div style={{ color: '#aaa', fontSize: '0.85rem' }}>
                                    {item.y} {item.q ? `• ${item.q}` : ''} {item.s ? `• ${item.s}` : ''}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <button
                    onClick={onClose}
                    className="glass-button"
                    style={{ marginTop: '1rem', alignSelf: 'flex-end' }}
                >
                    Close
                </button>
            </div>
        </div>
    );
};

export default MovieSearchModal;
