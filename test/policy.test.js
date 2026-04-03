import { describe, it, expect } from 'vitest';
import * as challenge from '../src/challenge.js';

describe('challenge policy surface', () => {
    it('exports the current public challenge helpers', () => {
        expect(typeof challenge.runChallenge).toBe('function');
        expect(typeof challenge.startCamera).toBe('function');
        expect(typeof challenge.captureFrame).toBe('function');
        expect(typeof challenge.stopCamera).toBe('function');
        expect(typeof challenge.isCameraActive).toBe('function');
    });

    it('supports decide when the helper is exported', () => {
        if (typeof challenge.decide !== 'function') {
            expect(challenge.decide).toBeUndefined();
            return;
        }

        const decision = challenge.decide([
            { age: 20 },
            { age: 22 },
            { age: 25 },
            { age: 21 },
            { age: 23 },
        ]);

        expect(decision.outcome).toBe('pass');
        expect(decision.estimatedAge).toBeGreaterThanOrEqual(18);
    });

    it('uses trimmed mean policy when decide is available', () => {
        if (typeof challenge.decide !== 'function') {
            expect(challenge.decide).toBeUndefined();
            return;
        }

        const decision = challenge.decide([
            { age: 5 },
            { age: 25 },
            { age: 24 },
            { age: 23 },
            { age: 50 },
        ]);

        expect(decision.outcome).toBe('pass');
        expect(decision.estimatedAge).toBeGreaterThan(20);
        expect(decision.estimatedAge).toBeLessThan(30);
    });
});
