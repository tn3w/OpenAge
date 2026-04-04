import { loadVision, loadModel, initTracker, track, destroyTracker } from './face-tracker.js';
import { startPositioning } from './positioning.js';
import { initAgeEstimator, estimateAgeBurst } from './age-estimator.js';
import {
    createSession as createLivenessSession,
    processFrame,
    isComplete,
    isPassed,
    currentInstruction,
    currentTaskId,
    progress,
} from './liveness.js';
import { createTransport } from './transport.js';
import {
    initVM,
    setFaceData,
    setChallengeParams,
    executeChallenge as execVM,
    registerBridge,
    unregisterBridge,
    destroyVM,
    toBase64,
    ensureModels,
    getMediaPipeModelBuffer,
    clearModelCache,
} from './vm-client.js';
import {
    BURST_FRAMES,
    BURST_INTERVAL_MS,
    ERROR_STEP_SECONDS,
    MAX_RETRIES,
    MOTION_CAPTURE_MS,
    MOTION_SAMPLE_MS,
} from './constants.js';

let stream = null;
let videoElement = null;

const CAMERA_CONSTRAINTS = {
    video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
    },
};

export function startCamera(video) {
    return navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS).then((s) => {
        stream = s;
        video.srcObject = stream;
        videoElement = video;

        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve({
                    width: video.videoWidth,
                    height: video.videoHeight,
                });
            };
        });
    });
}

export function captureFrame() {
    if (!videoElement) return null;

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    const context = canvas.getContext('2d');
    context.drawImage(videoElement, 0, 0);
    return canvas;
}

export function stopCamera() {
    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
    }
    if (videoElement) {
        videoElement.srcObject = null;
        videoElement = null;
    }
}

export function isCameraActive() {
    return stream !== null && videoElement !== null;
}

function computeAge(ageResults) {
    if (!ageResults || ageResults.length === 0) return null;

    const ages = ageResults.map((r) => r.age).sort((a, b) => a - b);

    const trimmed = ages.length >= 3 ? ages.slice(1, -1) : ages;

    return trimmed.reduce((s, a) => s + a, 0) / trimmed.length;
}

const TASK_LABELS = {
    'turn-left': 'Turn your head left',
    'turn-right': 'Turn your head right',
    nod: 'Nod your head',
    'blink-twice': 'Blink twice',
    'move-closer': 'Move closer then back',
};

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function resolveChallengeErrorMessage(error) {
    const name = typeof error?.name === 'string' ? error.name : '';
    const message = typeof error?.message === 'string' ? error.message : String(error || '');
    const normalized = `${name} ${message}`.toLowerCase();

    if (
        name === 'NotFoundError' ||
        /request is not allowed by the user agent or the platform in the current context/.test(
            normalized
        ) ||
        /requested device not found|device not found|no camera|could not start video source/.test(
            normalized
        )
    ) {
        return 'No camera available. Plug in a camera and try again.';
    }

    if (
        name === 'NotAllowedError' ||
        name === 'PermissionDeniedError' ||
        /permission|camera access|access denied/.test(normalized)
    ) {
        return 'Camera access was blocked. Allow camera access and try again.';
    }

    if (/positioning timeout/.test(normalized)) {
        return 'Face positioning timed out. Reopen the check and try again.';
    }

    return 'Verification failed. Please try again.';
}

function isInlineLayout(widget) {
    return widget?.params?.layout === 'inline';
}

async function showErrorStep(widget, error) {
    const message = resolveChallengeErrorMessage(error);

    if (isInlineLayout(widget)) {
        widget.showResult?.('retry', message);
        return;
    }

    if (!widget.popup) {
        widget.openPopup?.();
    }

    widget.showError?.(message);

    for (let seconds = ERROR_STEP_SECONDS; seconds > 0; seconds--) {
        if (!widget.popup) break;
        widget.setErrorCountdown?.(seconds);
        await sleep(1000);
    }

    widget.closePopup?.();
    widget.setState?.('retry');
}

async function handleChallengeError(widget, emitter, error) {
    console.log('Error during challenge:', error);
    await showErrorStep(widget, error);
    emitter.emit('error', error, widget.id);
    widget.params.errorCallback?.(error);
}

export async function runChallenge(widget, emitter) {
    const mode = widget.params.mode || 'serverless';

    if (mode !== 'serverless' && !widget.params.sitekey) {
        const err = new Error('Configuration error');
        widget.showResult?.('fail', 'Verification failed');
        emitter.emit('error', err, widget.id);
        widget.params.errorCallback?.(err);
        return;
    }

    if (mode === 'serverless') {
        return runServerless(widget, emitter);
    }
    return runServer(widget, emitter);
}

async function runServerless(widget, emitter) {
    const params = widget.params;
    let retryCount = 0;
    let modelBuffer = null;

    try {
        widget.openPopup();
        widget.setHeroStatus('Loading…');

        await Promise.all([loadVision(), initAgeEstimator()]);

        modelBuffer = await loadModel();

        if (isInlineLayout(widget)) {
            await startCameraFlow(widget, modelBuffer);
        } else {
            widget.showReady();
            await waitForStart(widget);
            await startCameraFlow(widget, modelBuffer);
        }

        const transport = createTransport('serverless', params);

        const attempt = async () => {
            widget.showLiveness();
            widget.setInstruction('');
            widget.setVideoStatus('Verifying…');

            const session = createLivenessSession();
            await runLivenessLoop(widget.popupElements.video, session, widget);

            if (session.failed || !isPassed(session)) {
                return { outcome: 'retry' };
            }

            widget.setInstruction('Hold still…');
            widget.setVideoStatus('Processing…');
            const frames = await captureFrameBurst(BURST_FRAMES, BURST_INTERVAL_MS);

            const ageResults = await estimateAgeBurst(frames);
            const estimatedAge = computeAge(ageResults);

            const result = await transport.verify({
                estimatedAge,
                livenessOk: true,
            });

            return {
                outcome: result.token ? 'pass' : 'fail',
                token: result.token,
            };
        };

        let result = await attempt();

        while (result.outcome === 'retry' && retryCount < MAX_RETRIES) {
            retryCount++;
            widget.showResult('retry', 'Please try again');
            await waitForStart(widget);
            await startCameraFlow(widget, modelBuffer);
            result = await attempt();
        }

        cleanupLocal();
        emitResult(widget, emitter, result);
    } catch (error) {
        cleanupLocal();
        await handleChallengeError(widget, emitter, error);
    }
}

async function runServer(widget, emitter) {
    const params = widget.params;

    try {
        widget.openPopup();
        widget.setHeroStatus('Connecting…');

        const transport = createTransport(params.mode, params);
        const session = await transport.createSession();

        widget.setHeroStatus('Loading…');
        await initVM(session);

        widget.setHeroStatus('Preparing…');
        await ensureModels(session, () => {});

        await loadVision();
        const buf = await getMediaPipeModelBuffer(session);
        await initTracker(buf);

        registerBridge({
            trackFace: () => {
                const video = widget.popupElements?.video;
                if (!video) return 'null';
                const r = track(video, performance.now());
                if (!r) return 'null';
                return JSON.stringify({
                    ts: r.timestampMs ?? performance.now(),
                    faceCount: r.faceCount,
                    headPose: r.headPose || null,
                    blendshapes: r.blendshapes || null,
                    boundingBox: r.boundingBox || null,
                });
            },
            captureFrame: () => (captureFrame() ? 'true' : 'null'),
        });

        let video;

        if (isInlineLayout(widget)) {
            video = widget.showCamera();
        } else {
            widget.showReady();
            await waitForStart(widget);
            video = widget.showCamera();
        }

        widget.setVideoStatus('Requesting camera…');
        await startCamera(video);
        exposeMirrorVideo(video);

        widget.setVideoStatus('Position your face');
        await waitForPositioning(video, widget);

        widget.showLiveness();
        transport.openChannel();

        let challenge = await transport.receive();
        const rounds = session.rounds;

        for (let i = 0; i < rounds; i++) {
            if (!challenge) {
                cleanupVM(transport);
                widget.showResult('fail', 'Verification failed');
                emitter.emit('error', 'failed', widget.id);
                return;
            }

            if (challenge.type === 'verdict') {
                cleanupVM(transport);
                emitVerdict(widget, emitter, challenge);
                return;
            }

            if (challenge.type === 'timeout') {
                cleanupVM(transport);
                widget.showResult('fail', 'Verification failed');
                emitter.emit('error', 'failed', widget.id);
                return;
            }

            widget.setVideoStatus(`Step ${i + 1} of ${rounds}`);

            const task = challenge.token?.task;
            widget.setInstruction(TASK_LABELS[task] ?? 'Look at the camera');
            widget.setTask(task);
            widget.setProgress(i / rounds);

            const faceData = await captureMotion(widget);
            setFaceData(faceData);
            setChallengeParams(challenge.token);

            let vmOut;
            try {
                vmOut = execVM();
            } catch {
                cleanupVM(transport);
                widget.showResult('fail', 'Verification failed');
                emitter.emit('error', 'failed', widget.id);
                return;
            }

            const payload = {
                token: challenge.token,
                tokenSignature: challenge.tokenSignature,
                response: toBase64(vmOut),
            };

            const result = await transport.sendAndReceive(payload);

            if (!result) {
                cleanupVM(transport);
                widget.showResult('fail', 'Verification failed');
                emitter.emit('error', 'failed', widget.id);
                return;
            }

            if (result.complete) {
                cleanupVM(transport);
                emitVerdict(widget, emitter, result);
                return;
            }

            if (result.hint) {
                widget.setVideoStatus(result.hint);
                await sleep(1000);
            }

            challenge = result.nextChallenge || null;
        }

        cleanupVM(transport);
    } catch (error) {
        cleanupVM();
        await handleChallengeError(widget, emitter, error);
    }
}

function emitVerdict(widget, emitter, response) {
    const verdict = response?.verdict || response;
    const token = verdict?.token || null;
    const params = widget.params;

    if (token) {
        widget.token = token;
        widget.showResult('pass', 'Verified');
        emitter.emit('verified', token, widget.id);
        params.callback?.(token);
        return;
    }

    widget.showResult('fail', 'Verification failed');
    emitter.emit('error', 'failed', widget.id);
    params.errorCallback?.('failed');
}

async function captureMotion(widget) {
    const video = widget.popupElements?.video;
    const history = [];
    const start = performance.now();

    while (performance.now() - start < MOTION_CAPTURE_MS) {
        const r = track(video, performance.now());
        if (r && r.faceCount === 1) {
            history.push({
                ts: r.timestampMs,
                headPose: r.headPose,
                blendshapes: r.blendshapes,
                boundingBox: r.boundingBox,
            });
        }
        await sleep(MOTION_SAMPLE_MS);
    }

    return {
        faceCount: history.length > 0 ? 1 : 0,
        motionHistory: history,
    };
}

function emitResult(widget, emitter, result) {
    const params = widget.params;

    if (result.outcome === 'pass') {
        widget.token = result.token || null;
        widget.showResult('pass', 'Verified');
        emitter.emit('verified', result.token, widget.id);
        params.callback?.(result.token);
    } else {
        widget.showResult('fail', 'Verification failed');
        emitter.emit('error', 'failed', widget.id);
        params.errorCallback?.('failed');
    }
}

function waitForStart(widget) {
    return new Promise((resolve) => {
        widget.onStartClick = () => {
            widget.onStartClick = null;
            resolve();
        };
    });
}

async function startCameraFlow(widget, modelBuffer) {
    const video = widget.showCamera();
    widget.setVideoStatus('Requesting camera…');
    await startCamera(video);

    widget.setVideoStatus('Preparing…');
    await initTracker(modelBuffer);

    widget.setVideoStatus('Position your face');
    await waitForPositioning(video, widget);
}

function waitForPositioning(video, widget) {
    return new Promise((resolve, reject) => {
        const handle = startPositioning(video, {
            onStatus: (text) => widget.setVideoStatus(text),
            onReady: () => resolve(),
        });

        setTimeout(() => {
            handle.cancel();
            reject(new Error('Positioning timeout'));
        }, 30000);
    });
}

async function runLivenessLoop(video, session, widget) {
    return new Promise((resolve) => {
        const loop = () => {
            const tracking = track(video, performance.now());
            if (tracking) processFrame(session, tracking);

            widget.setInstruction(currentInstruction(session) || 'Done');
            widget.setTask(currentTaskId(session));
            widget.setProgress(progress(session));
            widget.setVideoStatus(
                `Check ` +
                    `${Math.min(session.currentIndex + 1, session.tasks.length)}` +
                    ` of ${session.tasks.length}`
            );

            if (session.failed || isComplete(session)) {
                resolve();
                return;
            }

            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    });
}

async function captureFrameBurst(count, interval) {
    const frames = [];
    for (let i = 0; i < count; i++) {
        const frame = captureFrame();
        if (frame) frames.push(frame);
        if (i < count - 1) await sleep(interval);
    }
    return frames;
}

function cleanupLocal() {
    stopCamera();
    destroyTracker();
}

function cleanupVM(transport) {
    stopCamera();
    removeMirrorVideo();
    destroyTracker();
    unregisterBridge();
    destroyVM();
    clearModelCache();
    transport?.close();
}

function exposeMirrorVideo(source) {
    removeMirrorVideo();
    if (!source?.srcObject) return;
    const mirror = document.createElement('video');
    mirror.id = '__openage_mirror';
    mirror.srcObject = source.srcObject;
    mirror.autoplay = true;
    mirror.muted = true;
    mirror.playsInline = true;
    mirror.style.cssText =
        'position:fixed;width:1px;height:1px;' + 'opacity:0;pointer-events:none;z-index:-1;';
    document.body.appendChild(mirror);
}

function removeMirrorVideo() {
    document.getElementById('__openage_mirror')?.remove();
}
