import ALPR from '../src/alpr.js';

// Config
const CONFIG = {
    FRAME_INTERVAL_MS: 15,
    MIN_OCR_CONF: 0.9,
    IDEAL_WIDTH: 2400,
    IDEAL_HEIGHT: 1800,
    COLORS: {
        primary: '#ff6b35',
        text: '#2a2a2a',
        success: '#00AA00',
        error: '#ff0000'
    }
};

// Plate log persistence
const PLATE_LOG_KEY = 'alpr_plate_log';
const PLATE_LOG_OLD_KEY = 'alpr_plate_log_old';
const DEBOUNCE_MS = 60 * 60 * 1000; // 1 hour
const RECENT_WINDOW_MS = 60 * 1000; // 1 minute

// Track whether a reset happened this session (for export)
let resetThisSession = false;

// Clean up old backups on startup — keep only one
(function cleanupOldBackups() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('alpr_plate_log_old_')) keys.push(k);
    }
    // Keep the newest one, remove the rest
    if (keys.length > 1) {
        keys.sort();
        for (let i = 0; i < keys.length - 1; i++) {
            localStorage.removeItem(keys[i]);
        }
    }
})();

function loadPlateLog() {
    try {
        const raw = localStorage.getItem(PLATE_LOG_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function savePlateLog(log) {
    localStorage.setItem(PLATE_LOG_KEY, JSON.stringify(log));
}

function loadOldPlateLog() {
    // Find the old backup key
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('alpr_plate_log_old_')) {
            try { return JSON.parse(localStorage.getItem(k)); } catch { return {}; }
        }
    }
    return {};
}

function recordPlate(plate) {
    const log = loadPlateLog();
    const now = Date.now();
    if (log[plate]) {
        const elapsed = now - log[plate].lastSeen;
        if (elapsed >= DEBOUNCE_MS) {
            log[plate].count++;
            log[plate].lastSeen = now;
        }
    } else {
        log[plate] = { count: 1, firstSeen: now, lastSeen: now };
    }
    savePlateLog(log);
    return log[plate];
}

// Recent plates: last 5 unique plates seen within 1 minute
const recentPlates = []; // [{plate, time}]

// Current plate display with minimum 2s on screen + queue
const CURRENT_PLATE_MIN_MS = 2000;
let currentDisplayPlate = null;
let currentDisplayUntil = 0;
const plateQueue = []; // queued plates (no duplicates)
let queueTimerId = null;

function enqueuePlate(plate) {
    // Set as current immediately if nothing showing
    const now = Date.now();
    if (!currentDisplayPlate || now >= currentDisplayUntil) {
        showCurrentPlate(plate);
    } else {
        // Add to queue if not already queued and not the current plate
        if (plate !== currentDisplayPlate && !plateQueue.includes(plate)) {
            plateQueue.push(plate);
        }
    }
}

function showCurrentPlate(plate) {
    const log = loadPlateLog();
    const count = log[plate]?.count ?? 1;
    currentDisplayPlate = plate;
    currentDisplayUntil = Date.now() + CURRENT_PLATE_MIN_MS;

    const el = document.getElementById('current-plate');
    el.textContent = `${plate}  x${count}`;
    el.style.display = 'block';

    // Schedule next from queue
    clearTimeout(queueTimerId);
    queueTimerId = setTimeout(advanceQueue, CURRENT_PLATE_MIN_MS);

    renderTop5();
}

function advanceQueue() {
    if (plateQueue.length > 0) {
        showCurrentPlate(plateQueue.shift());
    }
    // current plate stays visible until replaced
}

function updateRecentPlates(plate) {
    const now = Date.now();
    // Add new plate to front
    recentPlates.unshift({ plate, time: now });
    // Remove duplicates (keep most recent)
    const seen = new Set();
    for (let i = recentPlates.length - 1; i >= 0; i--) {
        if (seen.has(recentPlates[i].plate)) {
            recentPlates.splice(i, 1);
        } else {
            seen.add(recentPlates[i].plate);
        }
    }
    while (recentPlates.length > 5) {
        const last = recentPlates[recentPlates.length - 1];
        if (now - last.time > RECENT_WINDOW_MS) {
            recentPlates.pop();
        } else {
            break;
        }
    }
    if (recentPlates.length > 5) recentPlates.length = 5;

    enqueuePlate(plate);
    renderAllPlatesList();
}

function renderTop5() {
    const log = loadPlateLog();
    const now = Date.now();
    const top5El = document.getElementById('top5-plates');

    top5El.innerHTML = recentPlates.map(r => {
        const count = log[r.plate]?.count ?? 1;
        const expired = now - r.time > RECENT_WINDOW_MS;
        const opacity = expired ? '0.4' : '1';
        const isCurrent = r.plate === currentDisplayPlate;
        const color = isCurrent ? '#ff6b35' : '#fff';
        return `<div style="
            font-size: 2.25rem;
            font-weight: 900;
            color: ${color};
            -webkit-text-stroke: 1.5px #000;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.6);
            opacity: ${opacity};
            white-space: nowrap;
            text-align: right;
        ">${r.plate}  x${count}</div>`;
    }).join('');
}

function renderAllPlatesList() {
    const log = loadPlateLog();
    const listEl = document.getElementById('all-plates-list');
    const wasAtTop = listEl.scrollTop <= 5;

    const sorted = Object.entries(log)
        .sort((a, b) => b[1].lastSeen - a[1].lastSeen);

    listEl.innerHTML = sorted.map(([plate, data]) => {
        const isCurrent = plate === currentDisplayPlate;
        const color = isCurrent ? '#ff6b35' : '#fff';
        const date = new Date(data.lastSeen);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `<div style="
            font-size: 0.8rem;
            color: ${color};
            text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
            display: flex;
            justify-content: space-between;
            gap: 0.5rem;
            padding: 0.1rem 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        "><span>${plate}</span><span style="opacity:0.7">x${data.count} ${timeStr}</span></div>`;
    }).join('');

    const autoScroll = document.getElementById('autoscroll-toggle')?.checked;
    if (autoScroll && wasAtTop) {
        listEl.scrollTop = 0;
    }
}

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
    captureCanvas: document.createElement('canvas'),
    exportBtn: document.getElementById('export-btn'),
    importBtn: document.getElementById('import-btn'),
    importFile: document.getElementById('import-file'),
    resetBtn: document.getElementById('reset-btn'),
    currentPlate: document.getElementById('current-plate'),
    top5Plates: document.getElementById('top5-plates'),
    allPlatesList: document.getElementById('all-plates-list'),
    autoscrollToggle: document.getElementById('autoscroll-toggle')
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
    // Detection log now handled by renderAllPlatesList
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

        if (result?.plate && result.plate !== "N/A" && result.ocr_conf >= CONFIG.MIN_OCR_CONF) {
            const now = new Date();
            const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
            const date = now.toISOString().split("T")[0];
            recordPlate(result.plate);
            state.entries.unshift([result.plate, result.ocr_conf, `${time} ${date}`]);
            if (state.entries.length > 100) state.entries.pop();
            updateDetectionLog();
            updateRecentPlates(result.plate);
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

// Export plate log to JSON file (+ old log as separate file if reset this session)
els.exportBtn.onclick = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const log = loadPlateLog();
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plates_${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);

    if (resetThisSession) {
        const old = loadOldPlateLog();
        if (Object.keys(old).length > 0) {
            const oldBlob = new Blob([JSON.stringify(old, null, 2)], { type: 'application/json' });
            const oldUrl = URL.createObjectURL(oldBlob);
            const oldA = document.createElement('a');
            oldA.href = oldUrl;
            oldA.download = `plates_old_${dateStr}.json`;
            oldA.click();
            URL.revokeObjectURL(oldUrl);
        }
    }
};

// Import plate log from JSON file
els.importBtn.onclick = () => els.importFile.click();
els.importFile.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const imported = JSON.parse(ev.target.result);
            const current = loadPlateLog();
            for (const [plate, data] of Object.entries(imported)) {
                if (current[plate]) {
                    current[plate].count = Math.max(current[plate].count, data.count);
                    current[plate].firstSeen = Math.min(current[plate].firstSeen, data.firstSeen);
                    current[plate].lastSeen = Math.max(current[plate].lastSeen, data.lastSeen);
                } else {
                    current[plate] = data;
                }
            }
            savePlateLog(current);
            renderAllPlatesList();
            setStatus("", `Imported ${Object.keys(imported).length} plates`, CONFIG.COLORS.success);
        } catch {
            setStatus("", 'Invalid JSON file', CONFIG.COLORS.error);
        }
        els.importFile.value = '';
    };
    reader.readAsText(file);
};

// Reset count with 3-second confirmation
let resetConfirmTimer = null;
els.resetBtn.onclick = () => {
    if (resetConfirmTimer) {
        // Confirmed — do the reset
        clearTimeout(resetConfirmTimer);
        resetConfirmTimer = null;
        els.resetBtn.textContent = 'Reset Count';
        els.resetBtn.classList.remove('btn-error');

        // Move current log to old with datetime in key name
        const now = new Date();
        const ts = now.toISOString().replace(/[:.]/g, '-');
        const oldKey = `alpr_plate_log_old_${ts}`;

        // Remove any existing old backups first (keep only one)
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith('alpr_plate_log_old_')) {
                localStorage.removeItem(k);
            }
        }

        // Save current as old
        const currentRaw = localStorage.getItem(PLATE_LOG_KEY);
        if (currentRaw) localStorage.setItem(oldKey, currentRaw);

        // Create fresh empty log
        savePlateLog({});
        resetThisSession = true;

        // Clear UI state
        state.entries = [];
        recentPlates.length = 0;
        currentDisplayPlate = null;
        currentDisplayUntil = 0;
        plateQueue.length = 0;
        clearTimeout(queueTimerId);
        els.currentPlate.style.display = 'none';
        els.currentPlate.textContent = '';
        els.top5Plates.innerHTML = '';
        els.allPlatesList.innerHTML = '';

        setStatus("", 'Counts reset', CONFIG.COLORS.success);
        return;
    }

    // First click — start confirmation
    els.resetBtn.textContent = 'Confirm?';
    els.resetBtn.classList.add('btn-error');
    resetConfirmTimer = setTimeout(() => {
        resetConfirmTimer = null;
        els.resetBtn.textContent = 'Reset Count';
        els.resetBtn.classList.remove('btn-error');
    }, 3000);
};

// Autoscroll toggle — jump to top when checked
els.autoscrollToggle.addEventListener('change', () => {
    if (els.autoscrollToggle.checked) {
        els.allPlatesList.scrollTop = 0;
    }
});

// Render existing plates on load
renderAllPlatesList();

// Dynamically size the spacer to match the plate overlay height
function updateSpacer() {
    const overlay = document.getElementById('plate-overlay');
    const spacer = document.getElementById('all-plates-spacer');
    if (overlay && spacer) {
        spacer.style.minHeight = (overlay.offsetHeight + 16) + 'px';
    }
    requestAnimationFrame(updateSpacer);
}
updateSpacer();

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
