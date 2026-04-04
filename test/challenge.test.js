import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    loadVision: vi.fn(),
    loadModel: vi.fn(),
    initTracker: vi.fn(),
    track: vi.fn(),
    destroyTracker: vi.fn(),
    startPositioning: vi.fn(),
    initAgeEstimator: vi.fn(),
    estimateAgeBurst: vi.fn(),
    createTransport: vi.fn(),
    initVM: vi.fn(),
    setFaceData: vi.fn(),
    setChallengeParams: vi.fn(),
    execVM: vi.fn(),
    registerBridge: vi.fn(),
    unregisterBridge: vi.fn(),
    destroyVM: vi.fn(),
    toBase64: vi.fn(),
    ensureModels: vi.fn(),
    getMediaPipeModelBuffer: vi.fn(),
    clearModelCache: vi.fn(),
}));

vi.mock('../src/face-tracker.js', () => ({
    loadVision: mocks.loadVision,
    loadModel: mocks.loadModel,
    initTracker: mocks.initTracker,
    track: mocks.track,
    destroyTracker: mocks.destroyTracker,
}));

vi.mock('../src/positioning.js', () => ({
    startPositioning: mocks.startPositioning,
}));

vi.mock('../src/age-estimator.js', () => ({
    initAgeEstimator: mocks.initAgeEstimator,
    estimateAgeBurst: mocks.estimateAgeBurst,
}));

vi.mock('../src/transport.js', async (importOriginal) => {
    const actual = await importOriginal();

    return {
        ...actual,
        createTransport: mocks.createTransport,
    };
});

vi.mock('../src/vm-client.js', () => ({
    initVM: mocks.initVM,
    setFaceData: mocks.setFaceData,
    setChallengeParams: mocks.setChallengeParams,
    executeChallenge: mocks.execVM,
    registerBridge: mocks.registerBridge,
    unregisterBridge: mocks.unregisterBridge,
    destroyVM: mocks.destroyVM,
    toBase64: mocks.toBase64,
    ensureModels: mocks.ensureModels,
    getMediaPipeModelBuffer: mocks.getMediaPipeModelBuffer,
    clearModelCache: mocks.clearModelCache,
}));

import { runChallenge } from '../src/challenge.js';
import { EventEmitter } from '../src/index.js';

describe('challenge module', () => {
    beforeEach(() => {
        vi.useRealTimers();

        mocks.loadVision.mockResolvedValue();
        mocks.loadModel.mockResolvedValue(new ArrayBuffer(8));
        mocks.initTracker.mockResolvedValue();
        mocks.track.mockReturnValue(null);
        mocks.startPositioning.mockReturnValue({
            cancel: vi.fn(),
        });
        mocks.initAgeEstimator.mockResolvedValue();
        mocks.estimateAgeBurst.mockResolvedValue([]);
        mocks.createTransport.mockReturnValue({
            verify: vi.fn().mockResolvedValue({ token: null }),
        });
        mocks.initVM.mockResolvedValue();
        mocks.ensureModels.mockResolvedValue();
        mocks.getMediaPipeModelBuffer.mockResolvedValue(new ArrayBuffer(8));
        mocks.clearModelCache.mockReturnValue();

        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            configurable: true,
            value: {
                getUserMedia: vi.fn(),
            },
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('exports runChallenge function', () => {
        expect(typeof runChallenge).toBe('function');
    });

    it('shows a timed popup error for unavailable cameras', async () => {
        vi.useFakeTimers();

        const emitter = new EventEmitter();
        const errors = [];
        const cameraError = new DOMException(
            'The request is not allowed by the user agent or the platform ' +
                'in the current context.',
            'NotFoundError'
        );

        emitter.on('error', (err) => errors.push(err));

        navigator.mediaDevices.getUserMedia.mockRejectedValue(cameraError);

        const widget = {
            params: { mode: 'serverless' },
            popup: null,
            popupElements: null,
            setHeroStatus: vi.fn(),
            setVideoStatus: vi.fn(),
            setInstruction: vi.fn(),
            setProgress: vi.fn(),
            setTask: vi.fn(),
            openPopup: vi.fn(),
            showHero: vi.fn(),
            showReady: vi.fn(),
            showCamera: vi.fn(() => ({
                srcObject: null,
                videoWidth: 640,
                videoHeight: 480,
                play: vi.fn(),
            })),
            showLiveness: vi.fn(),
            showError: vi.fn(),
            showResult: vi.fn(),
            showActions: vi.fn(),
            hideActions: vi.fn(),
            closePopup: vi.fn(),
            setErrorCountdown: vi.fn(),
            setState: vi.fn(),
            onStartClick: null,
        };

        widget.openPopup.mockImplementation(() => {
            widget.popup = { root: {} };
            widget.popupElements = {};
        });

        widget.showReady.mockImplementation(() => {
            setTimeout(() => {
                if (widget.onStartClick) widget.onStartClick();
            }, 0);
        });

        widget.closePopup.mockImplementation(() => {
            widget.popup = null;
            widget.popupElements = null;
        });

        const runPromise = runChallenge(widget, emitter);

        await Promise.resolve();
        await vi.runAllTimersAsync();
        await runPromise;

        expect(widget.showError).toHaveBeenCalledWith(
            'No camera available. Plug in a camera and try again.'
        );
        expect(widget.setErrorCountdown.mock.calls.map(([value]) => value)).toEqual(
            [5, 4, 3, 2, 1]
        );
        expect(widget.closePopup).toHaveBeenCalledTimes(1);
        expect(widget.setState).toHaveBeenCalledWith('retry');
        expect(errors).toEqual([cameraError]);
    });
});
