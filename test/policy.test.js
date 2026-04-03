import { describe, it, expect } from 'vitest';
import { decide } from '../src/challenge.js';

describe('decide', () => {
    it('returns pass when mean age >= threshold', () => {
        const results = [{ age: 20 }, { age: 22 }, { age: 25 }, { age: 21 }, { age: 23 }];
        const decision = decide(results);

        expect(decision.outcome).toBe('pass');
        expect(decision.estimatedAge).toBeGreaterThanOrEqual(18);
        expect(decision.reason).toBeNull();
    });

    it('returns fail when mean age < fail floor', () => {
        const results = [{ age: 10 }, { age: 11 }, { age: 12 }];
        const decision = decide(results);

        expect(decision.outcome).toBe('fail');
        expect(decision.estimatedAge).toBeLessThan(15);
    });

    it('returns retry for borderline ages', () => {
        const results = [{ age: 16 }, { age: 17 }, { age: 16 }];
        const decision = decide(results);

        expect(decision.outcome).toBe('retry');
    });

    it('returns retry for empty results', () => {
        const decision = decide([]);
        expect(decision.outcome).toBe('retry');
        expect(decision.estimatedAge).toBeNull();
    });

    it('returns retry for null results', () => {
        const decision = decide(null);
        expect(decision.outcome).toBe('retry');
    });

    it('uses custom threshold', () => {
        const results = [{ age: 20 }, { age: 20 }, { age: 20 }];
        const decision = decide(results, 21);

        expect(decision.outcome).toBe('retry');
    });

    it('trims outliers with >= 3 results', () => {
        const results = [{ age: 5 }, { age: 25 }, { age: 24 }, { age: 23 }, { age: 50 }];
        const decision = decide(results);

        expect(decision.outcome).toBe('pass');
        expect(decision.estimatedAge).toBeGreaterThan(20);
        expect(decision.estimatedAge).toBeLessThan(30);
    });

    it('handles single result', () => {
        const decision = decide([{ age: 30 }]);
        expect(decision.outcome).toBe('pass');
        expect(decision.estimatedAge).toBe(30);
    });
});
