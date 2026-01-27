
import ffmpegStatic from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import fetch from 'node-fetch';
import { path as ffprobePath } from 'ffprobe-static';

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobePath);

const videoUrl = "https://tyo1-4.download.real-debrid.com/d/GR5G6OO3CK5RI108/The.Family.Man.2019.S03E02.It%27s.Personal.1080p.AMZN.WEB-DL.DD%2B5.1.H.264-playWEB.mkv";
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

console.log("Testing direct ffprobe...");
try {
    ffmpeg.ffprobe(videoUrl, (err, metadata) => {
        if (err) console.log("Direct ffprobe failed:", err.message);
        else console.log("Direct ffprobe success:", metadata.format.duration);
    });
} catch (e) {
    console.log("Direct ffprobe error:", e);
}

console.log("Testing piped fetch ffprobe...");
fetch(videoUrl, { headers }).then(res => {
    ffmpeg(res.body).ffprobe((err, metadata) => {
        if (err) console.log("Piped ffprobe failed:", err.message);
        else console.log("Piped ffprobe success:", metadata.format.duration);
    });
});
