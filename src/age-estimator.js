import { FACEAPI_CDN, FACEAPI_MODEL_CDN } from './constants.js';

let initialized = false;
let faceapi = null;

function loadScript(url) {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined') {
            return reject(new Error('No DOM available'));
        }

        const existing = document.querySelector(`script[src="${url}"]`);
        if (existing) {
            if (window.faceapi) return resolve(window.faceapi);
            existing.addEventListener('load', () => resolve(window.faceapi));
            return;
        }

        const script = document.createElement('script');
        script.src = url;
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve(window.faceapi);
        script.onerror = () => reject(new Error(`Failed to load ${url}`));
        document.head.appendChild(script);
    });
}

export async function initAgeEstimator() {
    if (initialized) return;

    faceapi = await loadScript(FACEAPI_CDN);

    await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_CDN),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACEAPI_MODEL_CDN),
        faceapi.nets.ageGenderNet.loadFromUri(FACEAPI_MODEL_CDN),
    ]);

    initialized = true;
}

export async function estimateAge(canvas) {
    if (!faceapi) {
        throw new Error('Age estimator not initialized');
    }

    const detection = await faceapi
        .detectSingleFace(
            canvas,
            new faceapi.TinyFaceDetectorOptions({
                inputSize: 224,
            })
        )
        .withFaceLandmarks(true)
        .withAgeAndGender();

    if (!detection) return null;

    return {
        age: detection.age,
        gender: detection.gender,
        confidence: detection.detection.score,
    };
}

export async function estimateAgeBurst(frames) {
    const results = [];
    for (const frame of frames) {
        const result = await estimateAge(frame);
        if (result) results.push(result);
    }
    return results;
}

export function isInitialized() {
    return initialized;
}
