import { MEDIAPIPE_CDN, MEDIAPIPE_WASM, MEDIAPIPE_VISION, MEDIAPIPE_MODEL } from './constants.js';

let FaceLandmarker = null;
let landmarker = null;
let lastTimestampMs = -1;
let visionModule = null;

export async function loadVision() {
    if (visionModule) return visionModule;
    visionModule = await import(MEDIAPIPE_VISION);
    FaceLandmarker = visionModule.FaceLandmarker;
    return visionModule;
}

export async function loadModel() {
    const response = await fetch(MEDIAPIPE_MODEL);
    if (!response.ok) {
        throw new Error('Failed to load face landmarker model');
    }
    return new Uint8Array(await response.arrayBuffer());
}

export async function initTracker(modelBuffer) {
    const vision = await loadVision();
    const resolver = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);

    if (landmarker) {
        landmarker.close();
    }
    lastTimestampMs = -1;

    landmarker = await FaceLandmarker.createFromOptions(resolver, {
        baseOptions: {
            modelAssetBuffer: new Uint8Array(modelBuffer),
            delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 2,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
    });
}

export function track(video, timestampMs) {
    if (!landmarker) return null;

    const normalized = normalizeTimestamp(timestampMs);
    const result = landmarker.detectForVideo(video, normalized);
    const faceCount = result.faceLandmarks?.length ?? 0;

    if (faceCount === 0) {
        return { faceCount: 0, timestampMs: normalized };
    }

    const landmarks = result.faceLandmarks[0];

    return {
        faceCount,
        timestampMs: normalized,
        landmarks,
        blendshapes: parseBlendshapes(result.faceBlendshapes?.[0]),
        headPose: extractHeadPose(result.facialTransformationMatrixes?.[0]),
        boundingBox: computeBoundingBox(landmarks),
    };
}

export function destroyTracker() {
    if (landmarker) {
        landmarker.close();
        landmarker = null;
    }
    lastTimestampMs = -1;
}

export function isTrackerReady() {
    return landmarker !== null;
}

function normalizeTimestamp(timestampMs) {
    const safe = Number.isFinite(timestampMs) ? timestampMs : performance.now();
    const whole = Math.floor(safe);
    const normalized = Math.max(whole, lastTimestampMs + 1);
    lastTimestampMs = normalized;
    return normalized;
}

function parseBlendshapes(blendshapeResult) {
    if (!blendshapeResult?.categories) return {};
    const map = {};
    for (const category of blendshapeResult.categories) {
        map[category.categoryName] = category.score;
    }
    return map;
}

function extractHeadPose(matrix) {
    if (!matrix?.data || matrix.data.length < 16) {
        return { yaw: 0, pitch: 0, roll: 0 };
    }
    const m = matrix.data;
    const deg = 180 / Math.PI;
    return {
        yaw: Math.atan2(m[8], m[10]) * deg,
        pitch: Math.asin(-Math.max(-1, Math.min(1, m[9]))) * deg,
        roll: Math.atan2(m[1], m[5]) * deg,
    };
}

function computeBoundingBox(landmarks) {
    let minX = 1,
        minY = 1,
        maxX = 0,
        maxY = 0;

    for (const point of landmarks) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
    }

    const width = maxX - minX;
    const height = maxY - minY;

    return {
        x: minX,
        y: minY,
        width,
        height,
        area: width * height,
    };
}
