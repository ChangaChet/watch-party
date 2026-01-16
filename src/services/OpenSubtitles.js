const BASE_URL = import.meta.env.PROD
    ? '/api/opensubtitles'
    : 'http://localhost:3001/api/opensubtitles';

export const searchSubtitles = async (query) => {
    try {
        const response = await fetch(`${BASE_URL}/search?query=${encodeURIComponent(query)}`);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.details || errorData.error || 'Search failed');
        }
        return await response.json();
    } catch (error) {
        console.error('OpenSubtitles Search Error:', error);
        throw error;
    }
};

export const downloadSubtitle = async (url) => {
    try {
        const response = await fetch(`${BASE_URL}/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.details || errorData.error || 'Download failed');
        }
        return await response.json(); // Returns { content: "subtitle content..." }
    } catch (error) {
        console.error('OpenSubtitles Download Error:', error);
        throw error;
    }
};
