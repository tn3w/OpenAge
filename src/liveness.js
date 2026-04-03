import {
    TASK_TIMEOUT_MS,
    MIN_TASK_TIME_MS,
    TASK_COUNT,
    REQUIRED_TASK_PASSES,
} from './constants.js';

const TASKS = [
    {
        id: 'turn-left',
        instruction: 'Turn your head to the left',
        check: (h) => detectYawShift(h, 20),
    },
    {
        id: 'turn-right',
        instruction: 'Turn your head to the right',
        check: (h) => detectYawShift(h, -20),
    },
    {
        id: 'nod',
        instruction: 'Nod your head down then up',
        check: (h) => detectNod(h),
    },
    {
        id: 'blink-twice',
        instruction: 'Blink twice',
        check: (h) => detectDoubleBlink(h),
    },
    {
        id: 'move-closer',
        instruction: 'Move closer then back',
        check: (h) => detectDistanceChange(h),
    },
];

export function pickTasks(count = TASK_COUNT) {
    const shuffled = [...TASKS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}

export function createSession(tasks) {
    return {
        tasks: tasks || pickTasks(),
        currentIndex: 0,
        history: [],
        taskStartTime: 0,
        completedTasks: 0,
        requiredPasses: REQUIRED_TASK_PASSES,
        failed: false,
        failReason: null,
    };
}

export function processFrame(session, trackingResult) {
    if (session.failed || isComplete(session)) return;
    if (session.currentIndex >= session.tasks.length) return;
    if (!trackingResult || trackingResult.faceCount === 0) return;

    if (trackingResult.faceCount > 1) {
        session.failed = true;
        session.failReason = null;
        return;
    }

    const entry = {
        timestamp: trackingResult.timestampMs,
        headPose: trackingResult.headPose,
        blendshapes: trackingResult.blendshapes,
        boundingBox: trackingResult.boundingBox,
    };

    if (session.history.length === 0) {
        session.taskStartTime = trackingResult.timestampMs;
    }

    session.history.push(entry);

    const elapsed = trackingResult.timestampMs - session.taskStartTime;

    if (elapsed > TASK_TIMEOUT_MS) {
        advanceTask(session);
        return;
    }

    if (elapsed < MIN_TASK_TIME_MS) return;

    const task = session.tasks[session.currentIndex];
    if (!task.check(session.history)) return;

    if (isSuspicious(session.history)) {
        session.failed = true;
        session.failReason = null;
        return;
    }

    session.completedTasks++;
    advanceTask(session);
}

export function isComplete(session) {
    return session.currentIndex >= session.tasks.length;
}

export function isPassed(session) {
    return session.completedTasks >= session.requiredPasses;
}

export function currentInstruction(session) {
    if (session.currentIndex >= session.tasks.length) {
        return null;
    }
    return session.tasks[session.currentIndex].instruction;
}

export function currentTaskId(session) {
    if (session.currentIndex >= session.tasks.length) {
        return null;
    }
    return session.tasks[session.currentIndex].id;
}

export function progress(session) {
    if (session.tasks.length === 0) return 1;
    return Math.min(session.currentIndex / session.tasks.length, 1);
}

function advanceTask(session) {
    session.currentIndex++;
    session.history = [];
    session.taskStartTime = 0;

    const remaining = session.tasks.length - session.currentIndex;
    const canStillPass = session.completedTasks + remaining >= session.requiredPasses;

    if (!canStillPass) {
        session.failed = true;
        session.failReason = null;
    }
}

function detectYawShift(history, targetDelta) {
    if (history.length < 5) return false;
    const baseYaw = history[0].headPose.yaw;
    const direction = Math.sign(targetDelta);
    const threshold = Math.abs(targetDelta);

    return history.some((entry) => {
        const delta = (entry.headPose.yaw - baseYaw) * direction;
        return delta > threshold;
    });
}

function detectNod(history) {
    if (history.length < 10) return false;
    const basePitch = history[0].headPose.pitch;
    let wentDown = false;
    let cameBack = false;

    for (const entry of history) {
        const delta = entry.headPose.pitch - basePitch;
        if (delta > 15) wentDown = true;
        if (wentDown && Math.abs(delta) < 8) cameBack = true;
    }

    return wentDown && cameBack;
}

function detectDoubleBlink(history) {
    if (history.length < 10) return false;
    let blinkCount = 0;
    let eyesClosed = false;

    for (const entry of history) {
        const left = entry.blendshapes.eyeBlinkLeft ?? 0;
        const right = entry.blendshapes.eyeBlinkRight ?? 0;
        const bothClosed = left > 0.6 && right > 0.6;

        if (bothClosed && !eyesClosed) {
            blinkCount++;
            eyesClosed = true;
        } else if (!bothClosed) {
            eyesClosed = false;
        }
    }

    return blinkCount >= 2;
}

function detectDistanceChange(history) {
    if (history.length < 10) return false;
    const baseArea = history[0].boundingBox.area;
    let wentCloser = false;
    let cameBack = false;

    for (const entry of history) {
        const ratio = entry.boundingBox.area / baseArea;
        if (ratio > 1.3) wentCloser = true;
        if (wentCloser && ratio < 1.15) cameBack = true;
    }

    return wentCloser && cameBack;
}

export function isSuspicious(history) {
    if (history.length < 5) return false;

    const deltas = [];
    for (let i = 1; i < history.length; i++) {
        const dy = Math.abs(history[i].headPose.yaw - history[i - 1].headPose.yaw);
        const dp = Math.abs(history[i].headPose.pitch - history[i - 1].headPose.pitch);
        deltas.push(dy + dp);
    }

    if (deltas.every((d) => d < 0.1)) return true;

    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const variance = deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / deltas.length;

    return variance < 0.01 && mean > 0.5;
}
