// Config
const CONFIG = {
    FRAME_QUALITY: 1,
    FRAME_INTERVAL_MS: 15,
    MIN_OCR_CONF: 0.7,
    IDEAL_WIDTH: 2400,
    IDEAL_HEIGHT: 1800,
    COLORS: {
        primary: '#ff6b35',
        text: '#2a2a2a',
        success: '#00AA00',
        error: '#ff0000'
    }
};

// State
const state = {
    stream: null,
    ws: null,
    intervalId: null,
    frameCount: 0,
    pendingFrame: false,
    cropWidth: 400,
    cropHeight: 400
};

// DOM refs
const els = {
    video: document.getElementById('video'),
    canvas: document.getElementById('canvas'),
    startBtn: document.getElementById('start-btn'),
    streamBtn: document.getElementById('stream-btn'),
    stopStreamBtn: document.getElementById('stop-stream-btn'),
    cropHeight: document.getElementById('crop-height'),
    cropWidth: document.getElementById('crop-width'),
    controlButtons: document.getElementById('control-buttons'),
    status: document.getElementById('status'),
    captureCanvas: document.createElement('canvas')
};

// Utils
function setStatus(count, msg, color = CONFIG.COLORS.text) {
    els.status.textContent = count + msg;
    els.status.style.color = color;
}

function setButtonState(disabled) {
    els.streamBtn.disabled = disabled;
    els.stopStreamBtn.disabled = !disabled;
    els.startBtn.disabled = disabled;
}

// Camera init
els.startBtn.onclick = async () => {
    try {
        state.stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: CONFIG.IDEAL_WIDTH },
                height: { ideal: CONFIG.IDEAL_HEIGHT },
                facingMode: { ideal: 'environment' }
            }
        });

        els.video.srcObject = state.stream;
        const track = state.stream.getVideoTracks()[0];
        const { width, height } = track.getSettings();

        state.cropWidth = width;
        state.cropHeight = height;

        

        setStatus(
            "",
            `Camera ready: ${width}x${height}`,
            CONFIG.COLORS.success
        );

        els.startBtn.disabled = true;
        els.streamBtn.disabled = false;
    } catch (err) {
        setStatus("", `Camera error: ${err.message}`, CONFIG.COLORS.error);
    }
};

// WebSocket setup
els.streamBtn.onclick = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    state.frameCount = 0;

    setupCanvasOverlay();

    state.ws.onopen = handleWSOpen;
    state.ws.onmessage = handleWSMessage;
    state.ws.onerror = handleWSError;
    state.ws.onclose = handleWSClose;
};

function setupCanvasOverlay() {
    const rect = els.video.getBoundingClientRect();

    els.canvas.width = state.cropWidth;
    els.canvas.height = state.cropHeight;
    els.canvas.style.display = 'block';
    els.canvas.style.position = 'fixed';
    els.canvas.style.left = rect.left + 'px';
    els.canvas.style.top = rect.top + 'px';
    els.canvas.style.width = rect.width + 'px';
    els.canvas.style.height = rect.height + 'px';
    els.canvas.style.pointerEvents = 'none';
    els.canvas.style.zIndex = '10';
}

function handleWSOpen() {
    setStatus("", 'Streaming to server...');
    els.streamBtn.disabled = true;
    els.stopStreamBtn.disabled = false;

    state.intervalId = setInterval(captureAndSend, CONFIG.FRAME_INTERVAL_MS);
}

function captureAndSend() {
    if (state.pendingFrame) return;

    els.captureCanvas.width = state.cropWidth;
    els.captureCanvas.height = state.cropHeight;

    const ctx = els.captureCanvas.getContext('2d');
    const srcX = (els.video.videoWidth - state.cropWidth) / 2;
    const srcY = (els.video.videoHeight - state.cropHeight) / 2;

    ctx.drawImage(
        els.video,
        srcX, srcY, state.cropWidth, state.cropHeight,
        0, 0, state.cropWidth, state.cropHeight
    );

    const frame = els.captureCanvas.toDataURL('image/jpeg', CONFIG.FRAME_QUALITY);
    state.frameCount++;
    state.pendingFrame = true;

    state.ws.send(JSON.stringify({
        frame: frame,
        count: state.frameCount
    }));
}

function handleWSMessage(event) {
    state.pendingFrame = false;

    const data = JSON.parse(event.data);
    const ctx = els.canvas.getContext('2d');

    if (data.predictions?.ocr_conf > CONFIG.MIN_OCR_CONF) {
        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        drawDetection(ctx, data);
    } else {
        setStatus("", `Frame ${data.frame} processed`);
    }
}

function drawDetection(ctx, data) {
    const { bbox, plate, ocr_conf } = data.predictions;
    const [serverW, serverH] = data.resolution.split('x').map(Number);

    const scaleX = els.canvas.width / serverW;
    const scaleY = els.canvas.height / serverH;

    const x1 = bbox[0] * scaleX;
    const y1 = bbox[1] * scaleY;
    const x2 = bbox[2] * scaleX;
    const y2 = bbox[3] * scaleY;
    const w = x2 - x1;
    const h = y2 - y1;

    // Box
    ctx.strokeStyle = CONFIG.COLORS.primary;
    ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, w, h);

    // Label bg
    ctx.fillStyle = CONFIG.COLORS.primary;
    ctx.fillRect(x1, y1 - 25, 100, 25);

    // Label text
    ctx.fillStyle = CONFIG.COLORS.text;
    ctx.font = '16px monospace';
    ctx.fillText(plate, x1 + 5, y1 - 7);

    // Status
    const confPct = (ocr_conf * 100).toFixed(1);
    setStatus("", `Detected: ${plate} (conf: ${confPct}%)`, CONFIG.COLORS.success);
}

els.stopStreamBtn.onclick = () => {
    clearInterval(state.intervalId);
    state.ws.close();
    setStatus('Stream stopped');
    els.streamBtn.disabled = false;
    els.stopStreamBtn.disabled = true;
};

function handleWSError(error) {
    setStatus(`WebSocket error: ${error}`, CONFIG.COLORS.error);
}

function handleWSClose() {
    setStatus('Disconnected', CONFIG.COLORS.primary);
}