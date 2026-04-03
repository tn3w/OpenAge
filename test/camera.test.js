import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startCamera, captureFrame, stopCamera, isCameraActive } from '../src/challenge.js';

describe('camera', () => {
    let mockStream;
    let mockVideo;

    beforeEach(() => {
        stopCamera();

        mockStream = {
            getTracks: () => [{ stop: vi.fn() }],
        };

        mockVideo = {
            srcObject: null,
            videoWidth: 640,
            videoHeight: 480,
            onloadedmetadata: null,
            play: vi.fn(),
        };

        global.navigator = {
            mediaDevices: {
                getUserMedia: vi.fn().mockResolvedValue(mockStream),
            },
        };
    });

    it('isCameraActive returns false initially', () => {
        expect(isCameraActive()).toBe(false);
    });

    it('startCamera requests media and resolves', async () => {
        const promise = startCamera(mockVideo);

        await vi.waitFor(() => {
            expect(mockVideo.onloadedmetadata).toBeTruthy();
        });

        mockVideo.onloadedmetadata();

        const result = await promise;
        expect(result.width).toBe(640);
        expect(result.height).toBe(480);
        expect(mockVideo.play).toHaveBeenCalled();
    });

    it('captureFrame returns null without active camera', () => {
        expect(captureFrame()).toBeNull();
    });

    it('stopCamera cleans up', async () => {
        const promise = startCamera(mockVideo);

        await vi.waitFor(() => {
            expect(mockVideo.onloadedmetadata).toBeTruthy();
        });
        mockVideo.onloadedmetadata();
        await promise;

        stopCamera();
        expect(isCameraActive()).toBe(false);
        expect(mockVideo.srcObject).toBeNull();
    });
});
