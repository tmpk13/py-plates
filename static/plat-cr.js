import ALPR from '../src/alpr.js';

// Config
const CONFIG = {
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
    alpr: null,
    intervalId: null,
    frameCount: 0,
    pendingFrame: false,
    cropWidth: 400,
    cropHeight: 400,
    entries: [],
    // Zoom/selection
    zoomRegion: null,
    selActive: false,
    selStart: null,
    selCurrent: null,
    moveMode: false,
    moveDragStart: null,
    moveSnapshot: null
};

// DOM refs
const els = {
    video: document.getElementById('video'),
    canvas: document.getElementById('canvas'),
    videoContainer: document.getElementById('video-container'),
    startBtn: document.getElementById('start-btn'),
    streamBtn: document.getElementById('stream-btn'),
    stopStreamBtn: document.getElementById('stop-stream-btn'),
    controlButtons: document.getElementById('control-buttons'),
    status: document.getElementById('status'),
    zoomStatus: document.getElementById('zoom-status'),
    centeredToggle: document.getElementById('centered-toggle'),
    dataList: document.getElementById('data-list'),
    list: document.getElementById('list'),
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

function updateDetectionLog() {
    if (state.entries.length === 0) {
        els.dataList.style.display = 'none';
        return;
    }
    els.dataList.style.display = 'flex';
    els.list.innerHTML = state.entries
        .map(e => `<li class="data">${e[0]} | ${e[2]} | ${e[1]}</li>`)
        .join('');
}

function updateCenteredView() {
    if (!els.videoContainer) return;
    const centered = els.centeredToggle && els.centeredToggle.checked;
    if (!centered || !state.zoomRegion) {
        els.videoContainer.style.transformOrigin = '0 0';
        els.videoContainer.style.transform = '';
        return;
    }
    const { vx, vy, vw, vh } = state.zoomRegion;
    const PAD = 1.2;
    const W = window.innerWidth, H = window.innerHeight;
    const cw = els.canvas.width, ch = els.canvas.height;

    const cx_s = (vx + vw / 2) / cw * W;
    const cy_s = (vy + vh / 2) / ch * H;
    const vw_s = vw / cw * W;
    const vh_s = vh / ch * H;

    const scale = Math.min(W / (vw_s * PAD), H / (vh_s * PAD));
    const tx = W / 2 - cx_s * scale;
    const ty = H / 2 - cy_s * scale;

    els.videoContainer.style.transformOrigin = '0 0';
    els.videoContainer.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
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
    const cw = els.canvas.width, ch = els.canvas.height;
    let { vx, vy, vw: w, vh: h } = r;
    w = Math.max(w, MIN_ZOOM);
    h = Math.max(h, MIN_ZOOM);
    vx = Math.max(0, Math.min(vx, cw - w));
    vy = Math.max(0, Math.min(vy, ch - h));
    return { vx, vy, vw: w, vh: h };
}

// object-fit: cover coordinate transforms
function canvasToVideo(cx, cy) {
    const rect = els.video.getBoundingClientRect();
    const vw = els.video.videoWidth, vh = els.video.videoHeight;
    const scale = Math.max(rect.width / vw, rect.height / vh);
    const ox = (rect.width - vw * scale) / 2;
    const oy = (rect.height - vh * scale) / 2;
    return {
        vx: (cx / els.canvas.width * rect.width - ox) / scale,
        vy: (cy / els.canvas.height * rect.height - oy) / scale
    };
}

function videoToCanvas(vx, vy) {
    const rect = els.video.getBoundingClientRect();
    const vw = els.video.videoWidth, vh = els.video.videoHeight;
    const scale = Math.max(rect.width / vw, rect.height / vh);
    const ox = (rect.width - vw * scale) / 2;
    const oy = (rect.height - vh * scale) / 2;
    return {
        cx: (vx * scale + ox) / rect.width * els.canvas.width,
        cy: (vy * scale + oy) / rect.height * els.canvas.height
    };
}

// Zoom overlay drawing
function drawZoomOverlay(ctx) {
    if (!ctx) ctx = els.canvas.getContext('2d');
    const cw = els.canvas.width, ch = els.canvas.height;

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

    if (state.zoomRegion) {
        const { vx, vy, vw, vh } = state.zoomRegion;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, cw, ch);
        ctx.clearRect(vx, vy, vw, vh);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = CONFIG.COLORS.primary;
        ctx.lineWidth = 3;
        ctx.strokeRect(vx, vy, vw, vh);

        const hs = 12;
        ctx.fillStyle = CONFIG.COLORS.primary;
        [[vx, vy], [vx + vw - hs, vy], [vx, vy + vh - hs], [vx + vw - hs, vy + vh - hs]]
            .forEach(([hx, hy]) => ctx.fillRect(hx, hy, hs, hs));

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
    if (!state.alpr) return;

    const pos = getPointerCanvasPos(e);

    if (isInsideZoom(pos)) {
        state.moveMode = true;
        state.moveDragStart = pos;
        state.moveSnapshot = { ...state.zoomRegion };
        e.currentTarget.setPointerCapture(e.pointerId);
        els.canvas.style.cursor = 'grabbing';
        return;
    }

    state.selActive = true;
    state.selStart = pos;
    state.selCurrent = pos;
    e.currentTarget.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
    const pos = getPointerCanvasPos(e);
    const ctx = els.canvas.getContext('2d');

    if (state.moveMode) {
        const SENSITIVITY = 0.5;
        const dx = (pos.cx - state.moveDragStart.cx) * SENSITIVITY;
        const dy = (pos.cy - state.moveDragStart.cy) * SENSITIVITY;
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

        setStatus("", `Camera ready: ${width}x${height}`, CONFIG.COLORS.success);
        els.startBtn.disabled = true;
        els.streamBtn.disabled = false;
    } catch (err) {
        setStatus("", `Camera error: ${err.message}`, CONFIG.COLORS.error);
    }
};

// Start detection
els.streamBtn.onclick = async () => {
    els.streamBtn.disabled = true;
    setStatus("", "Loading ALPR models...");

    try {
        if (!state.alpr) {
            state.alpr = new ALPR();
            await state.alpr.load();
        }

        state.frameCount = 0;
        setupCanvasOverlay();

        setStatus("", "Running detection...");
        els.stopStreamBtn.disabled = false;

        state.intervalId = setInterval(captureAndProcess, CONFIG.FRAME_INTERVAL_MS);
    } catch (err) {
        setStatus("", `Model load error: ${err.message}`, CONFIG.COLORS.error);
        els.streamBtn.disabled = false;
    }
};

function setupCanvasOverlay() {
    els.canvas.width = state.cropWidth;
    els.canvas.height = state.cropHeight;
    els.canvas.style.pointerEvents = 'auto';
    els.canvas.style.cursor = 'crosshair';

    els.canvas.addEventListener('pointerdown', onPointerDown);
    els.canvas.addEventListener('pointermove', onPointerMove);
    els.canvas.addEventListener('pointerup', onPointerUp);
    els.canvas.addEventListener('dblclick', onDoubleClick);

    if (els.centeredToggle) {
        els.centeredToggle.addEventListener('change', updateCenteredView);
    }
    window.addEventListener('resize', updateCenteredView);
}

async function captureAndProcess() {
    if (state.pendingFrame) return;

    let srcX, srcY, srcW, srcH;
    if (state.zoomRegion) {
        const tl = canvasToVideo(state.zoomRegion.vx, state.zoomRegion.vy);
        const br = canvasToVideo(
            state.zoomRegion.vx + state.zoomRegion.vw,
            state.zoomRegion.vy + state.zoomRegion.vh
        );
        srcX = Math.round(tl.vx);
        srcY = Math.round(tl.vy);
        srcW = Math.round(br.vx - tl.vx);
        srcH = Math.round(br.vy - tl.vy);
    } else {
        srcX = 0;
        srcY = 0;
        srcW = els.video.videoWidth;
        srcH = els.video.videoHeight;
    }

    els.captureCanvas.width = srcW;
    els.captureCanvas.height = srcH;

    const captureCtx = els.captureCanvas.getContext('2d');
    captureCtx.drawImage(els.video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

    state.frameCount++;
    state.pendingFrame = true;

    try {
        const result = await state.alpr.predict(els.captureCanvas);

        if (result?.plate && result.plate !== "N/A") {
            const now = new Date();
            const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
            const date = now.toISOString().split("T")[0];
            state.entries.unshift([result.plate, result.ocr_conf, `${time} ${date}`]);
            if (state.entries.length > 100) state.entries.pop();
            updateDetectionLog();
        }

        const ctx = els.canvas.getContext('2d');
        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        drawZoomOverlay(ctx);

        if (result?.ocr_conf > CONFIG.MIN_OCR_CONF) {
            drawDetection(ctx, result);
        } else {
            setStatus("", `Frame ${state.frameCount} processed`);
        }
    } catch (e) {
        setStatus("", `Error: ${e.message}`, CONFIG.COLORS.error);
    }

    state.pendingFrame = false;
}

function drawDetection(ctx, result) {
    const { bbox, plate, ocr_conf } = result;

    let x1, y1, x2, y2;
    if (state.zoomRegion) {
        // bbox is in capture-canvas coords (video-space crop)
        // Convert crop origin + bbox offset back to canvas coords
        const tl = canvasToVideo(state.zoomRegion.vx, state.zoomRegion.vy);
        const p1 = videoToCanvas(tl.vx + bbox[0], tl.vy + bbox[1]);
        const p2 = videoToCanvas(tl.vx + bbox[2], tl.vy + bbox[3]);
        x1 = p1.cx; y1 = p1.cy;
        x2 = p2.cx; y2 = p2.cy;
    } else {
        // bbox is in video coords, convert to canvas coords
        const p1 = videoToCanvas(bbox[0], bbox[1]);
        const p2 = videoToCanvas(bbox[2], bbox[3]);
        x1 = p1.cx; y1 = p1.cy;
        x2 = p2.cx; y2 = p2.cy;
    }

    const w = x2 - x1;
    const h = y2 - y1;

    ctx.strokeStyle = CONFIG.COLORS.primary;
    ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, w, h);

    ctx.fillStyle = CONFIG.COLORS.primary;
    ctx.fillRect(x1, y1 - 25, 100, 25);

    ctx.fillStyle = CONFIG.COLORS.text;
    ctx.font = '16px monospace';
    ctx.fillText(plate, x1 + 5, y1 - 7);

    const confPct = (ocr_conf * 100).toFixed(1);
    setStatus("", `Detected: ${plate} (conf: ${confPct}%)`, CONFIG.COLORS.success);
}

// Stop detection
els.stopStreamBtn.onclick = () => {
    clearInterval(state.intervalId);

    state.zoomRegion = null;
    state.selActive = false;
    state.moveMode = false;
    state.selStart = null;
    state.selCurrent = null;

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
    setStatus("", 'Detection stopped');
    els.streamBtn.disabled = false;
    els.stopStreamBtn.disabled = true;
};
