const videoPlayer = document.getElementById("tvPlayer");

// Ensure iOS allows inline playback
videoPlayer.setAttribute("webkit-playsinline", "true");
videoPlayer.setAttribute("playsinline", "true");

const LAST_CHANNEL_KEY = "last_selected_channel";
let currentChannel = null;
let smoothPlayback = true;

// Fetch channels and populate buttons
async function fetchChannels() {
    try {
        const response = await fetch("/channels");
        const data = await response.json();
        const channelButtons = document.querySelector(".channel-buttons");
        channelButtons.innerHTML = "";

        if (!data.channels || data.channels.length === 0) {
            channelButtons.innerHTML = "<p>No channels available</p>";
            document.getElementById("channelName").textContent = "No channels available";
            document.getElementById("currentShow").textContent = "No active streams.";
            return;
        }

        data.channels.forEach(channel => {
            const button = document.createElement("button");
            button.textContent = `Channel ${channel}`;
            button.onclick = () => changeChannel(channel);
            channelButtons.appendChild(button);
        });

        const lastChannel = localStorage.getItem(LAST_CHANNEL_KEY);
        const initialChannel = data.channels.includes(lastChannel) ? lastChannel : data.channels[0];
        changeChannel(initialChannel);
    } catch (error) {
        console.error("Failed to load channels:", error);
        document.querySelector(".channel-buttons").innerHTML = "<p>Error loading channels</p>";
    }
}

// Change channel and seek to correct timestamp
async function changeChannel(channel) {
    if (currentChannel === channel) return;
    currentChannel = channel;

    document.getElementById("channelName").textContent = `Channel ${channel}`;
    document.getElementById("currentShow").textContent = `Now Playing: Loading...`;

    const streamUrl = `/hls/${channel}/index.m3u8`;
    let seekTime = 0;

    try {
        const response = await fetch(`/timestamp?channel=${channel}`);
        const data = await response.json();
        if (data.elapsed) seekTime = data.elapsed;
    } catch (error) {
        console.error("Failed to fetch timestamp:", error);
    }

    // Ensure seekTime is valid
    if (seekTime < 0 || isNaN(seekTime)) seekTime = 0;
    localStorage.setItem(LAST_CHANNEL_KEY, channel);

    // Stop previous HLS instance if it exists
    if (Hls.isSupported()) {
        if (videoPlayer.hlsInstance) {
            videoPlayer.hlsInstance.destroy();
        }

        const hls = new Hls({
    maxBufferLength: 60,  // Reduce buffer length to avoid drastic jumps
    maxMaxBufferLength: 120,
    maxBufferSize: 200 * 1000 * 1000, // Reduce max buffer size
    liveSyncDurationCount: 3, // Reduce to improve sync
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 30 // Keep back buffer smaller
});

        hls.loadSource(streamUrl);
hls.attachMedia(videoPlayer);
videoPlayer.hlsInstance = hls;

hls.on(Hls.Events.MANIFEST_PARSED, () => {
    console.log(`Seeking to ${seekTime}s`);
    videoPlayer.currentTime = seekTime; // Seek only once here
    videoPlayer.play().catch(err => console.error("Playback error:", err));
});

// Remove BUFFER_APPENDED seeking to prevent repeated jumpsp

        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.error("HLS Fatal Error:", data);
            }
        });

        videoPlayer.addEventListener("waiting", () => {
            console.warn("Video buffering...");
            smoothPlayback = false;
        });

        videoPlayer.addEventListener("playing", () => {
            smoothPlayback = true;
        });

        document.getElementById("currentShow").textContent = `Now Playing: Channel ${channel}`;
    } 
    else if (videoPlayer.canPlayType("application/vnd.apple.mpegurl")) {
        videoPlayer.src = streamUrl;
        videoPlayer.addEventListener("loadedmetadata", () => {
            console.log(`Seeking to ${seekTime}s`);
            videoPlayer.currentTime = seekTime;
            videoPlayer.play().catch(err => console.error("Playback error:", err));
        });

        document.getElementById("currentShow").textContent = `Now Playing: Channel ${channel}`;
    }
}

// Periodically check for playback drift
setInterval(async () => {
    if (!currentChannel || !smoothPlayback) return;

    try {
        const response = await fetch(`/timestamp?channel=${currentChannel}`);
        const data = await response.json();
        if (!data.elapsed) return;

        const serverTime = data.elapsed;
        const playerTime = videoPlayer.currentTime;
        const diff = Math.abs(serverTime - playerTime);

        if (diff > 3) {
            console.log(`Auto-correcting drift: ${playerTime} → ${serverTime}`);
            videoPlayer.currentTime = serverTime;
        }
    } catch (error) {
        console.error("Failed to sync playback:", error);
    }
}, 363636366633626); // More frequent drift correction

function togglePlay() {
    if (videoPlayer.paused) {
        videoPlayer.play();
    } else {
        videoPlayer.pause();
    }
}

function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else if (videoPlayer.requestFullscreen) {
        videoPlayer.requestFullscreen();
    } else if (videoPlayer.webkitRequestFullscreen) {
        videoPlayer.webkitRequestFullscreen();
    } else if (videoPlayer.msRequestFullscreen) {
        videoPlayer.msRequestFullscreen();
    } else if (videoPlayer.webkitEnterFullscreen) {
        videoPlayer.webkitEnterFullscreen();
    } else {
        alert("Fullscreen is not supported on this device.");
    }
}

window.onload = fetchChannels;
