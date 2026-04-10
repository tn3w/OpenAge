import { track } from './face-tracker.js';
import { STABLE_FRAMES_REQUIRED, POSITION_CHECK_MS, MIN_BRIGHTNESS } from './constants.js';

function sampleBrightness(video) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 64, 64);
    const pixels = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        sum += (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
    }
    return sum / (pixels.length / 4);
}

export function startPositioning(video, callbacks) {
    let stableFrames = 0;
    let cancelled = false;

    const check = () => {
        if (cancelled) return;

        if (sampleBrightness(video) < MIN_BRIGHTNESS) {
            callbacks.onStatus?.('More light needed');
            stableFrames = 0;
            setTimeout(check, POSITION_CHECK_MS);
            return;
        }

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
