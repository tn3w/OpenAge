import { startCamera, captureFrame, stopCamera, checkFrameQuality } from './camera.js';
import { ensureModels, getMediaPipeModelBuffer, clearCache } from './model-store.js';
import { initTracker, track, destroyTracker } from './face-tracker.js';
import {
    createLivenessSession,
    processFrame,
    isLivenessComplete,
    currentInstruction,
    currentTaskId,
    progress,
} from './liveness.js';
import { initAgeEstimator, estimateAgeBurst } from './age-estimator.js';
import { decide } from './policy.js';

const MAX_RETRIES = 3;
const BURST_FRAMES = 5;
const BURST_INTERVAL_MS = 200;
const POSITION_CHECK_MS = 100;

const State = {
    LOADING: 'LOADING',
    READY: 'READY',
    CAMERA: 'CAMERA',
    POSITIONING: 'POSITIONING',
    LIVENESS: 'LIVENESS',
    ESTIMATING: 'ESTIMATING',
    RESULT: 'RESULT',
};

const elements = {};
let state = State.LOADING;
let retryCount = 0;
let livenessSession = null;
let animationFrameId = null;

function $(id) {
    return document.getElementById(id);
}

function init() {
    elements.status = $('status');
    elements.hero = $('hero');
    elements.viewport = $('viewport');
    elements.videoContainer = $('video-container');
    elements.video = $('video');
    elements.overlay = $('overlay');
    elements.faceGuide = $('face-guide');
    elements.challengeHud = $('challenge-hud');
    elements.challengeText = $('challenge-text');
    elements.challengeProgress = $('challenge-progress');
    elements.videoStatus = $('video-status');
    elements.videoStatusText = $('video-status-text');
    elements.resultDisplay = $('result-display');
    elements.resultIcon = $('result-icon');
    elements.resultText = $('result-text');
    elements.startButton = $('start-button');
    elements.retryButton = $('retry-button');
    elements.clearButton = $('clear-button');

    elements.startButton.addEventListener('click', onStart);
    elements.retryButton.addEventListener('click', onRetry);
    elements.clearButton.addEventListener('click', onClear);

    loadModels();
}

async function loadModels() {
    try {
        setStatus('Loading models…');
        await ensureModels((p) => {
            setStatus(`Loading models… ${Math.round(p * 100)}%`);
        });

        setStatus('Initializing age estimator…');
        await initAgeEstimator();

        setStatus('Initializing face tracker…');
        const modelBuffer = await getMediaPipeModelBuffer();
        await initTracker(modelBuffer);

        transition(State.READY);
    } catch (error) {
        setStatus(`Setup failed: ${error.message}`);
    }
}

function transition(newState) {
    state = newState;

    elements.hero.classList.add('hidden');
    elements.videoContainer.classList.add('hidden');
    elements.faceGuide.classList.add('hidden');
    elements.challengeHud.classList.add('hidden');
    elements.videoStatus.classList.add('hidden');
    elements.resultDisplay.classList.add('hidden');
    elements.startButton.classList.add('hidden');
    elements.retryButton.classList.add('hidden');

    switch (newState) {
        case State.READY:
            elements.hero.classList.remove('hidden');
            setStatus('Ready to verify your age.');
            elements.startButton.classList.remove('hidden');
            break;

        case State.CAMERA:
            elements.hero.classList.remove('hidden');
            setStatus('Requesting camera access…');
            startCameraFlow();
            break;

        case State.POSITIONING:
            elements.videoContainer.classList.remove('hidden');
            elements.videoStatus.classList.remove('hidden');
            setVideoStatus('Position your face in the frame');
            startPositioning();
            break;

        case State.LIVENESS:
            elements.videoContainer.classList.remove('hidden');
            elements.faceGuide.classList.remove('hidden');
            elements.challengeHud.classList.remove('hidden');
            elements.videoStatus.classList.remove('hidden');
            livenessSession = createLivenessSession();
            updateChallengeUI();
            startLivenessLoop();
            break;

        case State.ESTIMATING:
            elements.videoContainer.classList.remove('hidden');
            elements.videoStatus.classList.remove('hidden');
            setVideoStatus('Estimating age…');
            runAgeEstimation();
            break;
    }
}

async function startCameraFlow() {
    try {
        await startCamera(elements.video);
        elements.overlay.width = elements.video.videoWidth;
        elements.overlay.height = elements.video.videoHeight;
        transition(State.POSITIONING);
    } catch {
        showResult('unsupported', 'Camera access denied or unavailable.');
    }
}

function startPositioning() {
    let stableFrames = 0;

    const check = () => {
        if (state !== State.POSITIONING) return;

        const result = track(elements.video, performance.now());

        if (!result || result.faceCount === 0) {
            setVideoStatus('No face detected — look at the camera');
            stableFrames = 0;
        } else if (result.faceCount > 1) {
            setVideoStatus('Multiple faces — only one person');
            stableFrames = 0;
        } else {
            const frame = captureFrame();
            const quality = frame ? checkFrameQuality(frame) : { ok: true };

            if (!quality.ok) {
                setVideoStatus(quality.reason);
                stableFrames = 0;
            } else {
                setVideoStatus('Face detected — hold still…');
                stableFrames++;
            }
        }

        if (stableFrames >= 10) {
            transition(State.LIVENESS);
            return;
        }

        setTimeout(check, POSITION_CHECK_MS);
    };
    check();
}

function startLivenessLoop() {
    const loop = () => {
        if (state !== State.LIVENESS) return;

        const timestampMs = performance.now();
        processFrame(livenessSession, elements.video, timestampMs);

        if (livenessSession.failed) {
            setVideoStatus(livenessSession.failReason);
            handleLivenessFail();
            return;
        }

        if (isLivenessComplete(livenessSession)) {
            transition(State.ESTIMATING);
            return;
        }

        updateChallengeUI();
        animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
}

function updateChallengeUI() {
    const instruction = currentInstruction(livenessSession);
    elements.challengeText.textContent = instruction ?? 'Done!';

    const taskId = currentTaskId(livenessSession);
    elements.faceGuide.setAttribute('data-task', taskId ?? '');

    const prog = progress(livenessSession);
    elements.challengeProgress.innerHTML =
        `<div class="bar" ` + `style="width:${prog * 100}%"></div>`;

    setVideoStatus(
        `Challenge ` + `${livenessSession.currentIndex + 1}` + ` of ${livenessSession.tasks.length}`
    );
}

async function runAgeEstimation() {
    const frames = [];

    for (let i = 0; i < BURST_FRAMES; i++) {
        const frame = captureFrame();
        if (frame) frames.push(frame);
        if (i < BURST_FRAMES - 1) {
            await sleep(BURST_INTERVAL_MS);
        }
    }

    if (frames.length === 0) {
        handleLivenessFail();
        return;
    }

    const ageResults = await estimateAgeBurst(frames);
    console.log('Age estimation results:', ageResults);
    const decision = decide(ageResults);

    switch (decision.outcome) {
        case 'pass':
            showResult('pass', 'Age verified. You may proceed.');
            break;
        case 'retry':
        case 'fail':
            handleRetryDecision();
            break;
    }
}

function handleLivenessFail() {
    retryCount++;
    if (retryCount >= MAX_RETRIES) {
        showResult('fail', 'Unable to verify. Try again later.');
        return;
    }
    showResult(
        'retry',
        `Verification unsuccessful. ` + `${MAX_RETRIES - retryCount} attempt(s) left.`
    );
}

function handleRetryDecision() {
    retryCount++;
    if (retryCount >= MAX_RETRIES) {
        showResult('fail', 'Unable to verify. Try again later.');
        return;
    }
    showResult('retry', `Could not confirm age. ` + `${MAX_RETRIES - retryCount} attempt(s) left.`);
}

function showResult(type, message) {
    cancelAnimationFrame(animationFrameId);
    stopCamera();
    destroyTracker();

    state = State.RESULT;

    elements.hero.classList.add('hidden');
    elements.videoContainer.classList.add('hidden');
    elements.faceGuide.classList.add('hidden');
    elements.challengeHud.classList.add('hidden');
    elements.videoStatus.classList.add('hidden');

    elements.resultDisplay.className = `result ${type}`;
    elements.resultDisplay.classList.remove('hidden');
    elements.resultText.textContent = message;
    setStatus('');

    if (type === 'retry') {
        elements.retryButton.classList.remove('hidden');
    }
}

function onStart() {
    retryCount = 0;
    transition(State.CAMERA);
}

async function onRetry() {
    setStatus('Reinitializing tracker…');
    const modelBuffer = await getMediaPipeModelBuffer();
    await initTracker(modelBuffer);
    transition(State.CAMERA);
}

async function onClear() {
    await clearCache();
    stopCamera();
    destroyTracker();
    elements.hero.classList.remove('hidden');
    elements.status.textContent = 'Data cleared. Reload to start again.';
    elements.startButton.classList.add('hidden');
    elements.retryButton.classList.add('hidden');
}

function setStatus(message) {
    elements.status.textContent = message;
}

function setVideoStatus(message) {
    elements.videoStatusText.textContent = message;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

document.addEventListener('DOMContentLoaded', init);
