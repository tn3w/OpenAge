import { track } from './face-tracker.js';
import { STABLE_FRAMES_REQUIRED, POSITION_CHECK_MS } from './constants.js';

export function startPositioning(video, callbacks) {
    let stableFrames = 0;
    let cancelled = false;

    const check = () => {
        if (cancelled) return;

        const result = track(video, performance.now());

        if (!result || result.faceCount === 0) {
            callbacks.onStatus?.('Look at the camera');
            stableFrames = 0;
        } else if (result.faceCount > 1) {
            callbacks.onStatus?.('Only one person please');
            stableFrames = 0;
        } else {
            callbacks.onStatus?.('Hold still…');
            stableFrames++;
        }

        if (stableFrames >= STABLE_FRAMES_REQUIRED) {
            callbacks.onReady?.();
            return;
        }

        setTimeout(check, POSITION_CHECK_MS);
    };

    check();

    return {
        cancel: () => {
            cancelled = true;
        },
    };
}
