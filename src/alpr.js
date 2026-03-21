// Browser-based ALPR using onnxruntime-web + Canvas API
// Expects `ort` global from onnxruntime-web CDN

const DET_SIZE = 384;
const DET_CONF_THRESH = 0.4;

const OCR = {
  width: 128,
  height: 64,
  maxSlots: 9,
  alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_",
};

export default class ALPR {
  constructor() {
    this.detSession = null;
    this.ocrSession = null;
  }

  async load(detUrl = "models/det.onnx", ocrUrl = "models/ocr.onnx") {
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

    console.log("Loading detection model...");
    this.detSession = await ort.InferenceSession.create(detUrl, {
      executionProviders: ["wasm"],
    });
    console.log("Loading OCR model...");
    this.ocrSession = await ort.InferenceSession.create(ocrUrl, {
      executionProviders: ["wasm"],
    });
    console.log("ALPR models loaded (browser)");
  }

  async predict(sourceCanvas) {
    const origW = sourceCanvas.width;
    const origH = sourceCanvas.height;

    // --- Detection ---
    const { tensor: detTensor, ratio, dw, dh } = this._detPreprocess(sourceCanvas, origW, origH);
    const detOut = await this.detSession.run({ images: detTensor });
    const preds = detOut["output0"].data;
    const numPreds = preds.length / 7;

    let best = null;
    for (let i = 0; i < numPreds; i++) {
      const b = i * 7;
      const conf = preds[b + 6];
      if (conf < DET_CONF_THRESH) continue;
      const x1 = Math.max(0, Math.min(Math.round((preds[b + 1] - dw) / ratio), origW));
      const y1 = Math.max(0, Math.min(Math.round((preds[b + 2] - dh) / ratio), origH));
      const x2 = Math.max(0, Math.min(Math.round((preds[b + 3] - dw) / ratio), origW));
      const y2 = Math.max(0, Math.min(Math.round((preds[b + 4] - dh) / ratio), origH));
      if (!best || conf > best.conf) best = { x1, y1, x2, y2, conf };
    }

    if (!best) {
      return { plate: "N/A", ocr_conf: 0.0, det_conf: 0.0, bbox: null, resolution: `${origW}x${origH}` };
    }

    // --- OCR ---
    const pw = Math.max(1, best.x2 - best.x1);
    const ph = Math.max(1, best.y2 - best.y1);

    const ocrTensor = this._ocrPreprocess(sourceCanvas, best.x1, best.y1, pw, ph);
    const ocrOut = await this.ocrSession.run({ input: ocrTensor });
    const logits = ocrOut["Identity:0"].data;

    let plate = "";
    let confSum = 0;
    for (let s = 0; s < OCR.maxSlots; s++) {
      let maxProb = -Infinity;
      let maxIdx = 0;
      for (let c = 0; c < OCR.alphabet.length; c++) {
        const p = logits[s * OCR.alphabet.length + c];
        if (p > maxProb) { maxProb = p; maxIdx = c; }
      }
      plate += OCR.alphabet[maxIdx];
      confSum += maxProb;
    }

    plate = plate.replace(/_/g, "");
    const avgConf = confSum / OCR.maxSlots;

    return {
      plate,
      ocr_conf: avgConf,
      det_conf: best.conf,
      bbox: [best.x1, best.y1, best.x2, best.y2],
      resolution: `${origW}x${origH}`,
    };
  }

  _detPreprocess(sourceCanvas, origW, origH) {
    const ratio = Math.min(DET_SIZE / origH, DET_SIZE / origW);
    const newW = Math.round(origW * ratio);
    const newH = Math.round(origH * ratio);
    const dw = (DET_SIZE - newW) / 2;
    const dh = (DET_SIZE - newH) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = DET_SIZE;
    canvas.height = DET_SIZE;
    const ctx = canvas.getContext("2d");

    // Letterbox fill
    ctx.fillStyle = "rgb(114, 114, 114)";
    ctx.fillRect(0, 0, DET_SIZE, DET_SIZE);
    ctx.drawImage(sourceCanvas, 0, 0, origW, origH, Math.round(dw), Math.round(dh), newW, newH);

    const imageData = ctx.getImageData(0, 0, DET_SIZE, DET_SIZE);
    const pixels = imageData.data; // RGBA

    const floats = new Float32Array(3 * DET_SIZE * DET_SIZE);
    const totalPixels = DET_SIZE * DET_SIZE;
    for (let i = 0; i < totalPixels; i++) {
      floats[0 * totalPixels + i] = pixels[i * 4 + 0] / 255.0;
      floats[1 * totalPixels + i] = pixels[i * 4 + 1] / 255.0;
      floats[2 * totalPixels + i] = pixels[i * 4 + 2] / 255.0;
    }

    const tensor = new ort.Tensor("float32", floats, [1, 3, DET_SIZE, DET_SIZE]);
    return { tensor, ratio, dw, dh };
  }

  _ocrPreprocess(sourceCanvas, x, y, w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = OCR.width;
    canvas.height = OCR.height;
    const ctx = canvas.getContext("2d");

    ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, OCR.width, OCR.height);

    const imageData = ctx.getImageData(0, 0, OCR.width, OCR.height);
    const rgba = imageData.data;

    const rgb = new Uint8Array(OCR.height * OCR.width * 3);
    for (let i = 0; i < OCR.height * OCR.width; i++) {
      rgb[i * 3 + 0] = rgba[i * 4 + 0];
      rgb[i * 3 + 1] = rgba[i * 4 + 1];
      rgb[i * 3 + 2] = rgba[i * 4 + 2];
    }

    return new ort.Tensor("uint8", rgb, [1, OCR.height, OCR.width, 3]);
  }
}
