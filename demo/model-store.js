const CACHE_NAME = 'openage-models-v1';

const FACE_API_BASE = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';

const FACE_API_MODELS = [
    'tiny_face_detector_model-weights_manifest.json',
    'tiny_face_detector_model-shard1',
    'face_landmark_68_tiny_model-weights_manifest.json',
    'face_landmark_68_tiny_model-shard1',
    'age_gender_model-weights_manifest.json',
    'age_gender_model-shard1',
];

const MEDIAPIPE_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/' +
    'face_landmarker/face_landmarker/float16/1/' +
    'face_landmarker.task';

function allModelUrls() {
    return [...FACE_API_MODELS.map((f) => `${FACE_API_BASE}/${f}`), MEDIAPIPE_MODEL_URL];
}

export async function ensureModels(onProgress) {
    const cache = await caches.open(CACHE_NAME);
    const urls = allModelUrls();
    let loaded = 0;

    for (const url of urls) {
        const cached = await cache.match(url);
        if (!cached) {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch model: ${url}`);
            }
            await cache.put(url, response);
        }
        loaded++;
        onProgress?.(loaded / urls.length);
    }
}

export async function getMediaPipeModelBuffer() {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(MEDIAPIPE_MODEL_URL);
    if (!response) throw new Error('MediaPipe model not cached');
    return response.arrayBuffer();
}

export function getFaceApiModelUrl() {
    return FACE_API_BASE;
}

export async function clearCache() {
    await caches.delete(CACHE_NAME);
}

export function installCacheInterceptor() {
    const originalFetch = window.fetch;

    window.fetch = async function (input, init) {
        const url =
            typeof input === 'string'
                ? input
                : input instanceof Request
                  ? input.url
                  : String(input);

        if (!url.startsWith(FACE_API_BASE)) {
            return originalFetch.call(this, input, init);
        }

        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(url);
        if (cached) return cached.clone();

        return originalFetch.call(this, input, init);
    };
}
