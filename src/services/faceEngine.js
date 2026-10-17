/**
 * Server-side face analysis for mobile face scan (enrolment + verification).
 *
 * The phone runs the same library for instant feedback, but the server never trusts a "match"
 * sent by the client: it recomputes the face descriptor from the uploaded JPEG and compares it
 * with the enrolled template itself. Runs on the WASM backend, so no native build on Windows.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const jpeg = require('jpeg-js');

// Model files must be identical at enrolment and verification time; the version is stored per template
const MODEL_VERSION = 'human-3.3.6-faceres';
// "@vladmandic/human/package.json" is not exported; its main entry lives in <pkg>/dist/
const HUMAN_DIR = path.resolve(path.dirname(require.resolve('@vladmandic/human')), '..');
const WASM_DIR = path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist');

const MAX_PIXELS = 1920 * 1920;

let humanPromise = null;
let queue = Promise.resolve();

/** The WASM build loads models with fetch(); Node's fetch has no file:// support, so serve those from disk. */
function installFileFetch() {
  if (globalThis.__faceFileFetch) return;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === 'string' ? url : url && url.url;
    if (typeof u === 'string' && u.startsWith('file://')) {
      const file = path.resolve(fileURLToPath(u));
      if (!file.startsWith(HUMAN_DIR + path.sep) && !file.startsWith(WASM_DIR + path.sep)) {
        throw new Error('file fetch outside model folders refused');
      }
      return new Response(await fs.promises.readFile(file));
    }
    return realFetch(url, opts);
  };
  globalThis.__faceFileFetch = true;
}

function getHuman() {
  if (!humanPromise) {
    humanPromise = (async () => {
      installFileFetch();
      require('@tensorflow/tfjs-core');
      require('@tensorflow/tfjs-backend-wasm');
      // The package "exports" map lacks a usable entry for the WASM build, so load the file directly
      const { Human } = require(path.join(HUMAN_DIR, 'dist', 'human.node-wasm.js'));
      const human = new Human({
        backend: 'wasm',
        wasmPath: `${pathToFileURL(WASM_DIR).href}/`,
        modelBasePath: `${pathToFileURL(path.join(HUMAN_DIR, 'models')).href}/`,
        debug: false,
        face: {
          enabled: true,
          detector: { rotation: true, maxDetected: 3, minConfidence: 0.5 },
          mesh: { enabled: true },
          iris: { enabled: false },
          description: { enabled: true },
          emotion: { enabled: false },
          antispoof: { enabled: true },
          liveness: { enabled: true }
        },
        body: { enabled: false }, hand: { enabled: false }, object: { enabled: false },
        gesture: { enabled: false }, segmentation: { enabled: false }
      });
      await human.load();
      await human.warmup();
      return human;
    })().catch(err => { humanPromise = null; throw err; });
  }
  return humanPromise;
}

/**
 * Analyse one JPEG. Resolves to
 *   { ok: true, embedding:number[], score, real, live, box, faces }  or  { ok: false, reason }
 * Detections run one at a time (WASM is single-threaded; parallel calls only add latency).
 */
function analyzeJpeg(buffer) {
  const run = async () => {
    let raw;
    try {
      raw = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 4, maxMemoryUsageInMB: 256 });
    } catch (err) {
      return { ok: false, reason: 'ไฟล์ภาพเสียหาย' };
    }
    if (!raw.width || !raw.height || raw.width * raw.height > MAX_PIXELS) return { ok: false, reason: 'ขนาดภาพไม่ถูกต้อง' };
    const human = await getHuman();
    const tensor = human.tf.tensor3d(raw.data, [raw.height, raw.width, 3], 'int32');
    let result;
    try {
      result = await human.detect(tensor);
    } finally {
      tensor.dispose();
    }
    const faces = (result.face || []).filter(f => f.score >= 0.6);
    if (faces.length === 0) return { ok: false, reason: 'ไม่พบใบหน้าในภาพ' };
    if (faces.length > 1) return { ok: false, reason: 'พบใบหน้ามากกว่า 1 คน' };
    const face = faces[0];
    if (!face.embedding || !face.embedding.length) return { ok: false, reason: 'ภาพไม่ชัดพอสำหรับจดจำใบหน้า' };
    // Face must fill a reasonable part of the frame; tiny faces give unreliable descriptors
    const [, , w, h] = face.box;
    if (w < raw.width * 0.18 || h < raw.height * 0.18) return { ok: false, reason: 'ใบหน้าเล็กเกินไป กรุณาขยับเข้าใกล้กล้อง' };
    return {
      ok: true,
      embedding: Array.from(face.embedding),
      score: round(face.score),
      real: round(face.real),
      live: round(face.live),
      // head turn in radians: negative = the person turned to their left (raw camera frame)
      yaw: round(face.rotation && face.rotation.angle ? face.rotation.angle.yaw : 0),
      box: face.box.map(Math.round),
      faces: faces.length
    };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

/** Similarity in [0, 1] (Human's normalised Euclidean); same person is typically above 0.5. */
async function similarity(a, b) {
  const human = await getHuman();
  return round(human.match.similarity(a, b));
}

const round = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

module.exports = { analyzeJpeg, similarity, getHuman, MODEL_VERSION };
