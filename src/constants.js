export const VERSION = '1.0.0';

export const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17';

export const MEDIAPIPE_WASM = `${MEDIAPIPE_CDN}/wasm`;

export const MEDIAPIPE_VISION = `${MEDIAPIPE_CDN}/vision_bundle.mjs`;

export const MEDIAPIPE_MODEL =
    'https://storage.googleapis.com/mediapipe-models/' +
    'face_landmarker/face_landmarker/float16/1/' +
    'face_landmarker.task';

export const FACEAPI_CDN =
    'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';

export const FACEAPI_MODEL_CDN =
    'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';

export const MAX_RETRIES = 3;
export const ERROR_STEP_SECONDS = 5;
export const BURST_FRAMES = 5;
export const BURST_INTERVAL_MS = 200;
export const POSITION_CHECK_MS = 100;
export const MOTION_CAPTURE_MS = 3000;
export const MOTION_SAMPLE_MS = 100;
export const TOKEN_EXPIRY_S = 300;
export const STABLE_FRAMES_REQUIRED = 10;

export const TASK_TIMEOUT_MS = 8000;
export const MIN_TASK_TIME_MS = 500;
export const TASK_COUNT = 3;
export const REQUIRED_TASK_PASSES = 2;

export const POPUP_MIN_WIDTH = 340;
export const POPUP_MIN_HEIGHT = 520;
export const POPUP_MARGIN = 12;
