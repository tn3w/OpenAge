import { track } from './face-tracker.js';

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

const TASK_TIMEOUT_MS = 8000;
const MIN_TASK_TIME_MS = 500;
const TASK_COUNT = 3;

export function pickTasks() {
    const shuffled = [...TASKS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, TASK_COUNT);
}

export function createLivenessSession() {
    const tasks = pickTasks();
    return {
        tasks,
        currentIndex: 0,
        history: [],
        taskStartTime: 0,
        completedTasks: 0,
        failed: false,
        failReason: null,
    };
}

export function processFrame(session, video, timestampMs) {
    if (session.failed || session.currentIndex >= session.tasks.length) return session;

    const result = track(video, timestampMs);
    if (!result || result.faceCount === 0) return session;

    const frameTimestampMs = result.timestampMs ?? timestampMs;

    if (result.faceCount > 1) {
        session.failed = true;
        session.failReason = 'Multiple faces detected';
        return session;
    }

    const entry = {
        timestamp: frameTimestampMs,
        headPose: result.headPose,
        blendshapes: result.blendshapes,
        boundingBox: result.boundingBox,
    };

    if (session.history.length === 0) {
        session.taskStartTime = frameTimestampMs;
    }

    session.history.push(entry);

    const elapsed = frameTimestampMs - session.taskStartTime;

    if (elapsed > TASK_TIMEOUT_MS) {
        session.failed = true;
        session.failReason = 'Task timed out';
        return session;
    }

    if (elapsed < MIN_TASK_TIME_MS) return session;

    const task = session.tasks[session.currentIndex];
    const passed = task.check(session.history);

    if (passed) {
        if (isSuspicious(session.history, task.id)) {
            session.failed = true;
            session.failReason = 'Suspicious motion pattern';
            return session;
        }

        session.completedTasks++;
        session.currentIndex++;
        session.history = [];
        session.taskStartTime = frameTimestampMs;
    }

    return session;
}

export function isLivenessComplete(session) {
    return session.currentIndex >= session.tasks.length;
}

export function currentInstruction(session) {
    if (session.currentIndex >= session.tasks.length) return null;
    return session.tasks[session.currentIndex].instruction;
}

export function currentTaskId(session) {
    if (session.currentIndex >= session.tasks.length) return null;
    return session.tasks[session.currentIndex].id;
}

export function progress(session) {
    if (session.tasks.length === 0) return 1;
    return session.currentIndex / session.tasks.length;
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
        const leftBlink = entry.blendshapes.eyeBlinkLeft ?? 0;
        const rightBlink = entry.blendshapes.eyeBlinkRight ?? 0;
        const bothClosed = leftBlink > 0.6 && rightBlink > 0.6;

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

function isSuspicious(history) {
    if (history.length < 5) return false;

    const deltas = [];
    for (let i = 1; i < history.length; i++) {
        const dYaw = Math.abs(history[i].headPose.yaw - history[i - 1].headPose.yaw);
        const dPitch = Math.abs(history[i].headPose.pitch - history[i - 1].headPose.pitch);
        deltas.push(dYaw + dPitch);
    }

    const allZero = deltas.every((d) => d < 0.1);
    if (allZero) return true;

    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const variance = deltas.reduce((sum, d) => sum + (d - mean) ** 2, 0) / deltas.length;

    if (variance < 0.01 && mean > 0.5) return true;

    return false;
}
