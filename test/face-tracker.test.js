import { describe, it, expect, vi } from 'vitest';

describe('face-tracker module', () => {
    it('exports expected functions', async () => {
        const mod = await import('../src/face-tracker.js');

        expect(typeof mod.loadVision).toBe('function');
        expect(typeof mod.loadModel).toBe('function');
        expect(typeof mod.initTracker).toBe('function');
        expect(typeof mod.track).toBe('function');
        expect(typeof mod.destroyTracker).toBe('function');
        expect(typeof mod.isTrackerReady).toBe('function');
    });

    it('isTrackerReady returns false initially', async () => {
        const { isTrackerReady } = await import('../src/face-tracker.js');
        expect(isTrackerReady()).toBe(false);
    });

    it('track returns null without init', async () => {
        const { track } = await import('../src/face-tracker.js');
        const video = document.createElement('video');
        expect(track(video, 123)).toBeNull();
    });

    it('destroyTracker does not throw', async () => {
        const { destroyTracker } = await import('../src/face-tracker.js');
        expect(() => destroyTracker()).not.toThrow();
    });
});
