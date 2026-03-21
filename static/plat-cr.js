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
    cropHeight: 400,
    // Zoom/selection
    zoomRegion: null,       // null = full frame; { vx, vy, vw, vh } in video pixel coords
    selActive: false,       // currently drawing a new selection
    selStart: null,         // { cx, cy } canvas-internal pixels
    selCurrent: null,       // { cx, cy } canvas-internal pixels during drag
    moveMode: false,        // repositioning an existing zoom box
    moveDragStart: null,    // { cx, cy } where move drag began
    moveSnapshot: null      // copy of zoomRegion at move-drag start
};

// DOM refs
const els = {
    video: document.getElementById('video'),
    canvas: document.getElementById('canvas'),
    videoContainer: document.getElementById('video-container'),
    startBtn: document.getElementById('start-btn'),
    streamBtn: document.getElementById('stream-btn'),
    stopStreamBtn: document.getElementById('stop-stream-btn'),
    cropHeight: document.getElementById('crop-height'),
    cropWidth: document.getElementById('crop-width'),
    controlButtons: document.getElementById('control-buttons'),
    status: document.getElementById('status'),
    zoomStatus: document.getElementById('zoom-status'),
    centeredToggle: document.getElementById('centered-toggle'),
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

function setZoomStatus(active) {
    if (!els.zoomStatus) return;
    if (active) {
        els.zoomStatus.textContent = 'ZOOM ACTIVE \u2014 double-click to reset';
        els.zoomStatus.style.display = 'block';
    } else {
        els.zoomStatus.style.display = 'none';
    }
}

function updateCenteredView() {
    if (!els.videoContainer) return;
    const centered = els.centeredToggle && els.centeredToggle.checked;
    if (!centered || !state.zoomRegion) {
        els.videoContainer.style.transform = '';
        els.videoContainer.style.transformOrigin = '';
        return;
    }
    const { vx, vy, vw, vh } = state.zoomRegion;
    const PAD = 1.2; // 20% padding around zoom area
    const W = window.innerWidth, H = window.innerHeight;
    const cw = els.canvas.width, ch = els.canvas.height;

    // Center of zoom region mapped to screen coords
    const cx_s = (vx + vw / 2) / cw * W;
    const cy_s = (vy + vh / 2) / ch * H;

    // Size of zoom region in screen coords
    const vw_s = vw / cw * W;
    const vh_s = vh / ch * H;

    const scale = Math.min(W / (vw_s * PAD), H / (vh_s * PAD));

    els.videoContainer.style.transformOrigin = `${cx_s}px ${cy_s}px`;
    els.videoContainer.style.transform = `scale(${scale})`;
}

// Helpers
function getPointerCanvasPos(e) {
    const rect = els.canvas.getBoundingClientRect();
    return {
        cx: (e.clientX - rect.left) * (els.canvas.width / rect.width),
        cy: (e.clientY - rect.top) * (els.canvas.height / rect.height)
    };
}

const MIN_ZOOM = 50;

function clampZoomRegion(r) {
    const vw = els.video.videoWidth, vh = els.video.videoHeight;
    let { vx, vy, vw: w, vh: h } = r;
    w = Math.max(w, MIN_ZOOM);
    h = Math.max(h, MIN_ZOOM);
    vx = Math.max(0, Math.min(vx, vw - w));
    vy = Math.max(0, Math.min(vy, vh - h));
    return { vx, vy, vw: w, vh: h };
}

// Zoom overlay drawing
// Canvas internal pixels == video pixels (1:1) because canvas.width = videoWidth
function drawZoomOverlay(ctx) {
    if (!ctx) ctx = els.canvas.getContext('2d');
    const cw = els.canvas.width, ch = els.canvas.height;

    // In-progress selection drag — white dashed rect
    if (state.selActive && state.selStart && state.selCurrent) {
        const x = Math.min(state.selStart.cx, state.selCurrent.cx);
        const y = Math.min(state.selStart.cy, state.selCurrent.cy);
        const w = Math.abs(state.selCurrent.cx - state.selStart.cx);
        const h = Math.abs(state.selCurrent.cy - state.selStart.cy);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        return;
    }

    // Committed zoom region: dark vignette over entire frame, clear window for zoom area
    if (state.zoomRegion) {
        const { vx, vy, vw, vh } = state.zoomRegion;

        ctx.save();
        // Dark overlay over entire canvas
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, cw, ch);
        // Punch transparent hole so video shows through at full brightness
        ctx.clearRect(vx, vy, vw, vh);
        ctx.restore();

        // Orange border around the clear window
        ctx.save();
        ctx.strokeStyle = CONFIG.COLORS.primary;
        ctx.lineWidth = 3;
        ctx.strokeRect(vx, vy, vw, vh);

        // Corner handles
        const hs = 12;
        ctx.fillStyle = CONFIG.COLORS.primary;
        [[vx, vy], [vx + vw - hs, vy], [vx, vy + vh - hs], [vx + vw - hs, vy + vh - hs]]
            .forEach(([hx, hy]) => ctx.fillRect(hx, hy, hs, hs));

        // ZOOM label above top-left corner
        ctx.fillRect(vx, vy - 24, 60, 24);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px monospace';
        ctx.fillText('ZOOM', vx + 4, vy - 6);
        ctx.restore();
    }
}

function isInsideZoom(pos) {
    if (!state.zoomRegion) return false;
    const { vx, vy, vw, vh } = state.zoomRegion;
    return pos.cx >= vx && pos.cx <= vx + vw && pos.cy >= vy && pos.cy <= vy + vh;
}

// Pointer event handlers
function onPointerDown(e) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

    const pos = getPointerCanvasPos(e);

    // If pointer starts inside existing zoom region, move it
    if (isInsideZoom(pos)) {
        state.moveMode = true;
        state.moveDragStart = pos;
        state.moveSnapshot = { ...state.zoomRegion };
        e.currentTarget.setPointerCapture(e.pointerId);
        els.canvas.style.cursor = 'grabbing';
        return;
    }

    // New selection drag
    state.selActive = true;
    state.selStart = pos;
    state.selCurrent = pos;
    e.currentTarget.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
    const pos = getPointerCanvasPos(e);
    const ctx = els.canvas.getContext('2d');

    if (state.moveMode) {
        const dx = pos.cx - state.moveDragStart.cx;
        const dy = pos.cy - state.moveDragStart.cy;
        state.zoomRegion = clampZoomRegion({
            vx: state.moveSnapshot.vx + dx,
            vy: state.moveSnapshot.vy + dy,
            vw: state.moveSnapshot.vw,
            vh: state.moveSnapshot.vh
        });
        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        drawZoomOverlay(ctx);
        updateCenteredView();
        return;
    }

    if (state.selActive) {
        state.selCurrent = pos;
        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        drawZoomOverlay(ctx);
        return;
    }

    // Update cursor based on hover position
    els.canvas.style.cursor = isInsideZoom(pos) ? 'grab' : 'crosshair';
}

function onPointerUp(_e) {
    if (state.moveMode) {
        state.moveMode = false;
        state.moveDragStart = null;
        state.moveSnapshot = null;
        els.canvas.style.cursor = isInsideZoom(getPointerCanvasPos(_e)) ? 'grab' : 'crosshair';
        updateCenteredView();
        return;
    }

    if (state.selActive) {
        state.selActive = false;

        const centerX = (state.selStart.cx + state.selCurrent.cx) / 2;
        const centerY = (state.selStart.cy + state.selCurrent.cy) / 2;
        const rawW = Math.abs(state.selCurrent.cx - state.selStart.cx);
        const rawH = Math.abs(state.selCurrent.cy - state.selStart.cy);

        // If too small in either dimension, expand to MIN_ZOOM centered on the drag center
        const finalW = Math.max(rawW, MIN_ZOOM);
        const finalH = Math.max(rawH, MIN_ZOOM);

        state.zoomRegion = clampZoomRegion({
            vx: centerX - finalW / 2,
            vy: centerY - finalH / 2,
            vw: finalW,
            vh: finalH
        });
        state.selStart = null;
        state.selCurrent = null;

        const ctx = els.canvas.getContext('2d');
        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        drawZoomOverlay(ctx);
        setZoomStatus(true);
        updateCenteredView();
    }
}

function onDoubleClick(_e) {
    state.zoomRegion = null;
    state.selActive = false;
    state.moveMode = false;
    state.selStart = null;
    state.selCurrent = null;

    const ctx = els.canvas.getContext('2d');
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    setZoomStatus(false);
    updateCenteredView();
    setStatus("", "Zoom reset");
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
    els.canvas.style.pointerEvents = 'auto';
    els.canvas.style.cursor = 'crosshair';
    els.canvas.style.zIndex = '10';

    els.canvas.addEventListener('pointerdown', onPointerDown);
    els.canvas.addEventListener('pointermove', onPointerMove);
    els.canvas.addEventListener('pointerup', onPointerUp);
    els.canvas.addEventListener('dblclick', onDoubleClick);

    if (els.centeredToggle) {
        els.centeredToggle.addEventListener('change', updateCenteredView);
    }
    window.addEventListener('resize', updateCenteredView);
}

function handleWSOpen() {
    setStatus("", 'Streaming to server...');
    els.streamBtn.disabled = true;
    els.stopStreamBtn.disabled = false;

    state.intervalId = setInterval(captureAndSend, CONFIG.FRAME_INTERVAL_MS);
}

function captureAndSend() {
    if (state.pendingFrame) return;

    let srcX, srcY, srcW, srcH;
    if (state.zoomRegion) {
        srcX = state.zoomRegion.vx;
        srcY = state.zoomRegion.vy;
        srcW = state.zoomRegion.vw;
        srcH = state.zoomRegion.vh;
    } else {
        srcX = 0;
        srcY = 0;
        srcW = els.video.videoWidth;
        srcH = els.video.videoHeight;
    }

    els.captureCanvas.width = srcW;
    els.captureCanvas.height = srcH;

    const ctx = els.captureCanvas.getContext('2d');
    ctx.drawImage(els.video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

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

    if (data.error) {
        setStatus("", `Error: ${data.error}`, CONFIG.COLORS.error);
        return;
    }

    const ctx = els.canvas.getContext('2d');
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

    // Always draw vignette/zoom overlay first
    drawZoomOverlay(ctx);

    if (data.predictions?.ocr_conf > CONFIG.MIN_OCR_CONF) {
        drawDetection(ctx, data);
    } else {
        setStatus("", `Frame ${data.frame} processed`);
    }
}

function drawDetection(ctx, data) {
    const { bbox, plate, ocr_conf } = data.predictions;
    const [serverW, serverH] = data.resolution.split('x').map(Number);

    let x1, y1, x2, y2;
    if (state.zoomRegion) {
        // Server received the cropped zoom region (1:1 video pixels)
        // Offset bbox by zoom region's top-left to position on full canvas
        x1 = state.zoomRegion.vx + bbox[0];
        y1 = state.zoomRegion.vy + bbox[1];
        x2 = state.zoomRegion.vx + bbox[2];
        y2 = state.zoomRegion.vy + bbox[3];
    } else {
        const scaleX = els.canvas.width / serverW;
        const scaleY = els.canvas.height / serverH;
        x1 = bbox[0] * scaleX;
        y1 = bbox[1] * scaleY;
        x2 = bbox[2] * scaleX;
        y2 = bbox[3] * scaleY;
    }

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

    // Reset zoom state
    state.zoomRegion = null;
    state.selActive = false;
    state.moveMode = false;
    state.selStart = null;
    state.selCurrent = null;

    // Disable canvas interaction
    els.canvas.style.pointerEvents = 'none';
    els.canvas.style.cursor = '';
    els.canvas.removeEventListener('pointerdown', onPointerDown);
    els.canvas.removeEventListener('pointermove', onPointerMove);
    els.canvas.removeEventListener('pointerup', onPointerUp);
    els.canvas.removeEventListener('dblclick', onDoubleClick);

    const ctx = els.canvas.getContext('2d');
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

    setZoomStatus(false);
    updateCenteredView();
    setStatus("", 'Stream stopped');
    els.streamBtn.disabled = false;
    els.stopStreamBtn.disabled = true;
};

function handleWSError(error) {
    setStatus("", `WebSocket error: ${error}`, CONFIG.COLORS.error);
}

function handleWSClose() {
    setStatus("", 'Disconnected', CONFIG.COLORS.primary);
}
