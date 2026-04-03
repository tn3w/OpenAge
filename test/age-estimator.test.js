import { describe, it, expect } from 'vitest';

describe('age-estimator module', () => {
    it('exports expected functions', async () => {
        const mod = await import('../src/age-estimator.js');

        expect(typeof mod.initAgeEstimator).toBe('function');
        expect(typeof mod.estimateAge).toBe('function');
        expect(typeof mod.estimateAgeBurst).toBe('function');
        expect(typeof mod.isInitialized).toBe('function');
    });

    it('isInitialized returns false initially', async () => {
        const { isInitialized } = await import('../src/age-estimator.js');
        expect(isInitialized()).toBe(false);
    });

    it('estimateAge throws without init', async () => {
        const { estimateAge } = await import('../src/age-estimator.js');
        const canvas = document.createElement('canvas');

        await expect(estimateAge(canvas)).rejects.toThrow('not initialized');
    });
});
