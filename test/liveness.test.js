import { describe, it, expect } from 'vitest';
import {
    createSession,
    processFrame,
    isComplete,
    isPassed,
    currentInstruction,
    currentTaskId,
    progress,
    isSuspicious,
    pickTasks,
} from '../src/liveness.js';

function makeTracking(overrides = {}) {
    return {
        faceCount: 1,
        timestampMs: Date.now(),
        headPose: { yaw: 0, pitch: 0, roll: 0 },
        blendshapes: {},
        boundingBox: { x: 0, y: 0, width: 0.3, height: 0.4, area: 0.12 },
        ...overrides,
    };
}

describe('pickTasks', () => {
    it('returns requested number of tasks', () => {
        expect(pickTasks(2).length).toBe(2);
        expect(pickTasks(5).length).toBe(5);
    });
});

describe('createSession', () => {
    it('creates session with default tasks', () => {
        const session = createSession();

        expect(session.tasks.length).toBe(3);
        expect(session.currentIndex).toBe(0);
        expect(session.completedTasks).toBe(0);
        expect(session.failed).toBe(false);
    });

    it('creates session with custom tasks', () => {
        const tasks = pickTasks(2);
        const session = createSession(tasks);
        expect(session.tasks.length).toBe(2);
    });
});

describe('processFrame', () => {
    it('ignores null tracking', () => {
        const session = createSession();
        processFrame(session, null);
        expect(session.history.length).toBe(0);
    });

    it('ignores zero face count', () => {
        const session = createSession();
        processFrame(session, makeTracking({ faceCount: 0 }));
        expect(session.history.length).toBe(0);
    });

    it('fails on multiple faces', () => {
        const session = createSession();
        processFrame(session, makeTracking({ faceCount: 2 }));
        expect(session.failed).toBe(true);
        expect([null, 'Multiple faces detected']).toContain(session.failReason);
    });

    it('adds frame to history', () => {
        const session = createSession();
        processFrame(session, makeTracking());
        expect(session.history.length).toBe(1);
    });
});

describe('state queries', () => {
    it('isComplete returns false initially', () => {
        const session = createSession();
        expect(isComplete(session)).toBe(false);
    });

    it('isPassed returns false initially', () => {
        const session = createSession();
        expect(isPassed(session)).toBe(false);
    });

    it('currentInstruction returns first task', () => {
        const session = createSession();
        const instruction = currentInstruction(session);
        expect(typeof instruction).toBe('string');
        expect(instruction.length).toBeGreaterThan(0);
    });

    it('currentTaskId returns first task id', () => {
        const session = createSession();
        const taskId = currentTaskId(session);
        expect(typeof taskId).toBe('string');
    });

    it('progress starts at 0', () => {
        const session = createSession();
        expect(progress(session)).toBe(0);
    });
});

describe('isSuspicious', () => {
    it('returns false for short history', () => {
        expect(
            isSuspicious([
                {
                    headPose: { yaw: 0, pitch: 0 },
                },
            ])
        ).toBe(false);
    });

    it('detects all-zero deltas', () => {
        const history = Array.from({ length: 10 }, () => ({
            headPose: { yaw: 5, pitch: 5 },
        }));
        expect(isSuspicious(history)).toBe(true);
    });

    it('passes natural motion', () => {
        const history = Array.from({ length: 10 }, (_, i) => ({
            headPose: {
                yaw: Math.sin(i * 0.5) * 10,
                pitch: Math.cos(i * 0.3) * 5,
            },
        }));
        expect(isSuspicious(history)).toBe(false);
    });
});
