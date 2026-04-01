import {
  getFaceApiModelUrl,
  installCacheInterceptor,
} from "./model-store.js";

let initialized = false;

export async function initAgeEstimator() {
  if (initialized) return;

  installCacheInterceptor();

  const modelUrl = getFaceApiModelUrl();

  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelUrl),
    faceapi.nets.ageGenderNet.loadFromUri(modelUrl),
  ]);

  initialized = true;
}

export async function estimateAge(canvas) {
  const detection = await faceapi
    .detectSingleFace(
      canvas,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })
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

export function modelVersion() {
  return "face-api.js@0.22.2/ageGenderNet";
}
