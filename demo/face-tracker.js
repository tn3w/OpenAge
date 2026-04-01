const VISION_CDN = 'https://cdn.jsdelivr.net/npm/' + '@mediapipe/tasks-vision@0.10.17/wasm';

let FaceLandmarker = null;
let landmarker = null;

export async function initTracker(modelBuffer) {
    const vision = await import(
        'https://cdn.jsdelivr.net/npm/' + '@mediapipe/tasks-vision@0.10.17/' + 'vision_bundle.mjs'
    );

    FaceLandmarker = vision.FaceLandmarker;
    const filesetResolver = await vision.FilesetResolver.forVisionTasks(VISION_CDN);

    landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
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

    const result = landmarker.detectForVideo(video, timestampMs);
    const faceCount = result.faceLandmarks?.length ?? 0;

    if (faceCount === 0) return { faceCount: 0 };

    const landmarks = result.faceLandmarks[0];
    const blendshapes = parseBlendshapes(result.faceBlendshapes?.[0]);
    const headPose = extractHeadPose(result.facialTransformationMatrixes?.[0]);
    const boundingBox = computeBoundingBox(landmarks);

    return {
        faceCount,
        landmarks,
        blendshapes,
        headPose,
        boundingBox,
    };
}

export function destroyTracker() {
    if (landmarker) {
        landmarker.close();
        landmarker = null;
    }
}

function parseBlendshapes(blendshapeResult) {
    if (!blendshapeResult?.categories) return {};

    const map = {};
    for (const cat of blendshapeResult.categories) {
        map[cat.categoryName] = cat.score;
    }
    return map;
}

function extractHeadPose(matrix) {
    if (!matrix?.data || matrix.data.length < 16) {
        return { yaw: 0, pitch: 0, roll: 0 };
    }

    const m = matrix.data;
    const deg = 180 / Math.PI;

    const yaw = Math.atan2(m[8], m[10]) * deg;
    const pitch = Math.asin(-Math.max(-1, Math.min(1, m[9]))) * deg;
    const roll = Math.atan2(m[1], m[5]) * deg;

    return { yaw, pitch, roll };
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

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        area: (maxX - minX) * (maxY - minY),
    };
}
