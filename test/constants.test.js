import { describe, it, expect } from 'vitest';
import * as constants from '../src/constants.js';

describe('constants', () => {
    it('exports VERSION as string', () => {
        expect(typeof constants.VERSION).toBe('string');
        expect(constants.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('exports CDN URLs', () => {
        expect(constants.MEDIAPIPE_CDN).toContain('jsdelivr');
        expect(constants.FACEAPI_CDN).toContain('jsdelivr');
        expect(constants.MEDIAPIPE_MODEL).toContain('mediapipe-models');
    });

    it('exports numeric thresholds', () => {
        expect(constants.MAX_RETRIES).toBe(3);
        expect(constants.BURST_FRAMES).toBeGreaterThan(0);
        expect(constants.STABLE_FRAMES_REQUIRED).toBeGreaterThan(0);
    });

    it('exports timing values', () => {
        expect(constants.BURST_INTERVAL_MS).toBeGreaterThan(0);
        expect(constants.POSITION_CHECK_MS).toBeGreaterThan(0);
        expect(constants.TASK_TIMEOUT_MS).toBeGreaterThan(0);
        expect(constants.TOKEN_EXPIRY_S).toBeGreaterThan(0);
    });

    it('exports popup dimensions', () => {
        expect(constants.POPUP_MIN_WIDTH).toBeGreaterThan(0);
        expect(constants.POPUP_MIN_HEIGHT).toBeGreaterThan(0);
        expect(constants.POPUP_MARGIN).toBeGreaterThan(0);
    });
});
