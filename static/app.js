import { startCamera, captureFrame, stopCamera, checkFrameQuality } from './camera.js';
import {
    ensureModels,
    getMediaPipeModelBuffer,
    clearCache,
    installCacheInterceptor,
} from './model-store.js';
import { initTracker, track, destroyTracker } from './face-tracker.js';
import {
    createSession,
    loadVM,
    setFaceData,
    setChallengeParams,
    executeChallenge,
    openTransport,
    getFirstChallenge,
    submitVerification,
    destroyVM,
    getSession,
    registerBridge,
    unregisterBridge,
} from './vm-client.js';

const MAX_RETRIES = 3;
const POSITION_CHECK_MS = 100;
const MOTION_CAPTURE_MS = 3000;
const MOTION_SAMPLE_MS = 100;

const TASK_INSTRUCTIONS = {
    'turn-left': 'Turn your head to the left',
    'turn-right': 'Turn your head to the right',
    nod: 'Nod your head down then up',
    'blink-twice': 'Blink twice',
    'move-closer': 'Move closer then back',
};

const State = {
    LOADING: 'LOADING',
    READY: 'READY',
    CAMERA: 'CAMERA',
    POSITIONING: 'POSITIONING',
    CHALLENGE: 'CHALLENGE',
    RESULT: 'RESULT',
};

const elements = {};
let state = State.LOADING;
let retryCount = 0;
let lastCapturedFrame = null;

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
            setStatus('Setting up secure session…');
            startSecureFlow();
            break;

        case State.POSITIONING:
            elements.videoContainer.classList.remove('hidden');
            elements.videoStatus.classList.remove('hidden');
            setVideoStatus('Position your face in the frame');
            startPositioning();
            break;

        case State.CHALLENGE:
            elements.videoContainer.classList.remove('hidden');
            elements.faceGuide.classList.remove('hidden');
            elements.challengeHud.classList.remove('hidden');
            elements.videoStatus.classList.remove('hidden');
            runChallengeRounds();
            break;
    }
}

async function startSecureFlow() {
    try {
        setStatus('Creating secure session…');
        await createSession();

        setStatus('Loading WASM VM…');
        await loadVM();

        setStatus('Decrypting AI models…');
        installCacheInterceptor();
        await ensureModels((progress) => {
            setStatus(`Decrypting models… ` + `${Math.round(progress * 100)}%`);
        });

        setStatus('Initializing face tracker…');
        const buf = await getMediaPipeModelBuffer();
        await initTracker(buf);

        registerBridge({
            trackFace: () => {
                const result = track(elements.video, performance.now());
                if (!result) return 'null';
                return JSON.stringify({
                    ts: result.timestampMs ?? Math.round(performance.now()),
                    faceCount: result.faceCount,
                    headPose: result.headPose || null,
                    blendshapes: result.blendshapes || null,
                    boundingBox: result.boundingBox || null,
                });
            },
            captureFrame: () => {
                lastCapturedFrame = captureFrame();
                return lastCapturedFrame ? 'true' : 'null';
            },
        });

        setStatus('Requesting camera…');
        await startCamera(elements.video);
        elements.overlay.width = elements.video.videoWidth;
        elements.overlay.height = elements.video.videoHeight;

        transition(State.POSITIONING);
    } catch (error) {
        showResult('unsupported', `Session setup failed: ${error.message}`);
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
            transition(State.CHALLENGE);
            return;
        }

        setTimeout(check, POSITION_CHECK_MS);
    };
    check();
}

async function runChallengeRounds() {
    const session = getSession();
    const totalRounds = session.rounds;

    openTransport();
    let challenge = await getFirstChallenge();

    for (let round = 0; round < totalRounds; round++) {
        if (!challenge) {
            showResult('fail', 'Connection lost.');
            return;
        }
        if (challenge.type === 'verdict') {
            handleVerdict(challenge.verdict);
            return;
        }
        if (challenge.type === 'timeout') {
            showResult('fail', 'Session timed out.');
            return;
        }

        setVideoStatus(`Round ${round + 1} of ${totalRounds}…`);

        const task = challenge.token?.task;
        const instruction = TASK_INSTRUCTIONS[task] ?? 'Look at the camera';

        elements.challengeText.textContent = instruction;
        elements.faceGuide.setAttribute('data-task', task);
        updateProgress(round, totalRounds);

        const faceData = await captureMotionAndAge();

        setFaceData(faceData);
        setChallengeParams(challenge.token);

        let vmResponse;
        try {
            vmResponse = executeChallenge();
        } catch (error) {
            showResult('fail', `VM execution failed: ${error.message}`);
            destroyVM();
            return;
        }

        const result = await submitVerification(
            challenge.token,
            challenge.tokenSignature,
            vmResponse
        );

        if (result.complete) {
            handleVerdict(result.verdict);
            return;
        }

        if (result.error) {
            setVideoStatus(`Round error: ${result.error}`);
            await sleep(1000);
        }

        challenge = result.nextChallenge;
    }
}

async function captureMotionAndAge() {
    const motionHistory = [];
    const startTime = performance.now();

    while (performance.now() - startTime < MOTION_CAPTURE_MS) {
        const tracking = track(elements.video, performance.now());

        if (tracking && tracking.faceCount === 1) {
            motionHistory.push({
                ts: tracking.timestampMs,
                headPose: tracking.headPose,
                blendshapes: tracking.blendshapes,
                boundingBox: tracking.boundingBox,
            });
        }

        await sleep(MOTION_SAMPLE_MS);
    }

    const lastTracking = motionHistory.length > 0 ? motionHistory[motionHistory.length - 1] : null;

    return {
        faceCount: lastTracking ? 1 : 0,
        motionHistory,
    };
}

function updateProgress(current, total) {
    const fraction = current / total;
    elements.challengeProgress.innerHTML =
        `<div class="bar" ` + `style="width:${fraction * 100}%"></div>`;
}

function handleVerdict(verdict) {
    destroyVM();
    switch (verdict.outcome) {
        case 'pass':
            showResult('pass', buildVerdictMessage('Age verified. You may proceed.', verdict));
            break;
        case 'fail':
            showResult('fail', buildVerdictMessage('Unable to verify. Try again later.', verdict));
            break;
        case 'retry':
            handleRetryDecision(verdict);
            break;
        default:
            showResult('fail', 'Verification inconclusive.');
    }
}

function handleRetryDecision(verdict = null) {
    retryCount++;
    if (retryCount >= MAX_RETRIES) {
        showResult('fail', buildVerdictMessage('Unable to verify. Try again later.', verdict));
        return;
    }
    showResult(
        'retry',
        buildVerdictMessage(
            `Could not confirm age. ${MAX_RETRIES - retryCount} attempt(s) left.`,
            verdict
        )
    );
}

function buildVerdictMessage(baseMessage, verdict) {
    const parts = [baseMessage];

    if (Number.isFinite(verdict?.estimatedAge)) {
        parts.push(buildEstimatedAgeText(verdict.estimatedAge));
    }

    if (verdict?.reason) {
        parts.push(`Reason: ${verdict.reason}.`);
    }

    return parts.join(' ');
}

function buildEstimatedAgeText(age) {
    return `Estimated age: ${formatEstimatedAge(age)}.`;
}

function formatEstimatedAge(age) {
    return age.toFixed(1).replace(/\.0$/, '');
}

function showResult(type, message) {
    stopCamera();
    destroyTracker();
    unregisterBridge();
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
    setStatus('Reinitializing…');
    transition(State.CAMERA);
}

async function onClear() {
    await clearCache();
    destroyVM();
    unregisterBridge();
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
