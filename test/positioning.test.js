import { describe, it, expect, vi } from 'vitest';
import { startPositioning } from '../src/positioning.js';

vi.mock('../src/face-tracker.js', () => ({
    track: vi.fn(),
}));

import { track } from '../src/face-tracker.js';

describe('startPositioning', () => {
    it('calls onStatus when no face detected', async () => {
        track.mockReturnValue(null);

        const onStatus = vi.fn();
        const onReady = vi.fn();

        const handle = startPositioning(document.createElement('video'), { onStatus, onReady });

        await new Promise((r) => setTimeout(r, 200));
        handle.cancel();

        expect(
            onStatus.mock.calls.some(([text]) =>
                ['No face detected', 'Look at the camera'].includes(text)
            )
        ).toBe(true);
    });

    it('calls onReady after stable frames', async () => {
        track.mockReturnValue({
            faceCount: 1,
            timestampMs: Date.now(),
        });

        const onReady = vi.fn();

        startPositioning(document.createElement('video'), { onStatus: vi.fn(), onReady });

        await new Promise((r) => setTimeout(r, 1500));

        expect(onReady).toHaveBeenCalled();
    });

    it('cancel stops the loop', async () => {
        track.mockReturnValue({ faceCount: 1 });

        const onReady = vi.fn();
        const handle = startPositioning(document.createElement('video'), {
            onStatus: vi.fn(),
            onReady,
        });

        handle.cancel();
        await new Promise((r) => setTimeout(r, 300));

        expect(onReady).not.toHaveBeenCalled();
    });

    it('reports multiple faces', async () => {
        track.mockReturnValue({ faceCount: 2 });

        const onStatus = vi.fn();
        startPositioning(document.createElement('video'), { onStatus, onReady: vi.fn() });

        await new Promise((r) => setTimeout(r, 200));

        expect(
            onStatus.mock.calls.some(([text]) =>
                ['Multiple faces detected', 'Only one person please'].includes(text)
            )
        ).toBe(true);
    });
});
