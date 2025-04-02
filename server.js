const express = require("express");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const cors = require("cors");

const app = express();
const PORT = 7860;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const hlsFolder = path.join(__dirname, "hls");
if (!fs.existsSync(hlsFolder)) fs.mkdirSync(hlsFolder);

const streams = {}; // Active FFmpeg processes
const queues = loadQueues(); // Load persisted queues
const timestamps = loadTimestamps(); // Load timestamps from file
const activeChannels = new Set(Object.keys(queues)); // Restore active channels

// Load and save queues
function loadQueues() {
    const file = path.join(__dirname, "queues.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
}
function saveQueues() {
    fs.writeFileSync(path.join(__dirname, "queues.json"), JSON.stringify(queues, null, 2));
}

// Load and save timestamps
function loadTimestamps() {
    const file = path.join(__dirname, "timestamps.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
}
function saveTimestamps() {
    fs.writeFileSync(path.join(__dirname, "timestamps.json"), JSON.stringify(timestamps, null, 2));
}

// Add video to queue
app.get("/add", (req, res) => {
    const { channel, video } = req.query;
    if (!channel || !video) return res.status(400).json({ error: "Channel and video URL required" });

    if (!queues[channel]) queues[channel] = [];
    queues[channel].push(video);
    activeChannels.add(channel);
    saveQueues();

    console.log(`Added video to channel ${channel}: ${video}`);

    if (!streams[channel]) {
        startStream(channel);
    }

    res.json({ message: "Video added to queue", queue: queues[channel] });
});

// Start streaming next video in queue
// Start streaming next video in queue
function startStream(channel) {
    if (!queues[channel] || queues[channel].length === 0) {
        console.log(`No more videos for channel ${channel}`);
        delete streams[channel];
        activeChannels.delete(channel);
        saveQueues();
        return;
    }

    if (streams[channel]) {
        console.log(`Stopping existing stream for ${channel}`);
        try {
            streams[channel].kill("SIGKILL");
        } catch (error) {
            console.error(`Error stopping stream for ${channel}:`, error);
        }
        delete streams[channel];
    }

    const videoUrl = queues[channel].shift();
    const outputFolder = path.join(hlsFolder, channel);
    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });

    // Ensure timestamps[channel] is set up correctly and only updates if needed
    if (!timestamps[channel]) {
        timestamps[channel] = { start: Date.now(), elapsed: 0 };
    } else {
        timestamps[channel].elapsed = timestamps[channel].elapsed || 0;  // Retain the elapsed time if available
    }

    saveQueues();
    saveTimestamps();

    console.log(`Streaming ${videoUrl} on channel ${channel} from ${timestamps[channel].elapsed}s`);

    streams[channel] = ffmpeg(videoUrl)
        .inputOptions(timestamps[channel].elapsed > 0 ? [`-ss ${timestamps[channel].elapsed}`] : []) 
        .output(`${outputFolder}/index.m3u8`)
        .addOptions([
            "-c:v libx264",
            "-preset veryfast",
            "-crf 23",
            "-b:v 1000k",
            "-c:a aac",
            "-b:a 128k",
            "-hls_time 4",
            "-hls_list_size 30",
            "-hls_flags append_list+independent_segments",
            "-hls_segment_type mpegts",
            "-hls_delete_threshold 50",
            "-g 24",
            "-r 24",
            "-bufsize 4000k",
            "-maxrate 1200k",
            "-strict -2",
        ])
        .on("start", () => {
            console.log(`FFmpeg started for ${channel}`);
            // We don't reset start time in the start event, so it stays consistent
        })
        .on("end", () => {
            console.log(`Finished streaming for ${channel}`);
            
            // Calculate and store the final elapsed time before stopping
            const now = Date.now();
            timestamps[channel].elapsed += Math.floor((now - timestamps[channel].start) / 1000);
            
            delete streams[channel];

            if (queues[channel] && queues[channel].length > 0) {
                timestamps[channel].start = now; // Reset start time for next video
                saveTimestamps();
                startStream(channel);
            } else {
                delete timestamps[channel]; // Remove if no more videos
                saveTimestamps();
            }
        })
        .on("error", (err) => {
            console.error(`FFmpeg error for ${channel}:`, err);
            saveTimestamps();

            if (err.message.includes("Invalid data found") || err.message.includes("No such file")) {
                console.log(`Skipping corrupted video: ${videoUrl}`);
                delete timestamps[channel];
            }

            delete streams[channel];

            if (queues[channel] && queues[channel].length > 0) {
                startStream(channel);
            }
        })
        .run();
}

// Skip to next video
app.get("/next", (req, res) => {
    const { channel } = req.query;
    if (!channel || !streams[channel]) return res.status(400).json({ error: "No active stream" });

    if (!queues[channel] || queues[channel].length === 0) {
        return res.json({ message: "No more videos." });
    }

    console.log(`Skipping video for channel ${channel}`);
    streams[channel].kill("SIGKILL");
    delete streams[channel];

    timestamps[channel] = { start: Date.now(), elapsed: 0 };
    saveTimestamps();
    startStream(channel);

    res.json({ message: "Skipped to next video" });
});

// Get active channels
app.get("/channels", (req, res) => {
    res.json({ channels: Array.from(activeChannels) });
});

// Serve HLS files
app.use("/hls", express.static(hlsFolder));

// Get real-time timestamp
app.get("/timestamp", (req, res) => {
    const { channel } = req.query;
    if (!channel) return res.status(400).json({ error: "Channel is required" });

    if (!timestamps[channel] || !timestamps[channel].start) {
        return res.json({ elapsed: 0 });
    }

    const elapsed = Math.floor((Date.now() - timestamps[channel].start) / 1000) + timestamps[channel].elapsed;
    res.json({ elapsed });
});

// Recover streams after restart
function recoverStreams() {
    for (const channel of Object.keys(queues)) {
        if (queues[channel].length > 0 && !streams[channel]) {
            console.log(`Recovering stream for ${channel}`);
            startStream(channel);
        }
    }
}

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    recoverStreams();
});
