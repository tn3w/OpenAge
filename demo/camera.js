const CONSTRAINTS = {
    video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
    },
};

const MIN_BRIGHTNESS = 55;
const MAX_BRIGHTNESS = 205;
const MIN_CONTRAST = 20;
const MIN_SHARPNESS = 3;

let stream = null;
let videoElement = null;

export async function startCamera(video) {
    stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    video.srcObject = stream;
    videoElement = video;

    return new Promise((resolve) => {
        video.onloadedmetadata = () => {
            video.play();
            resolve({
                width: video.videoWidth,
                height: video.videoHeight,
            });
        };
    });
}

export function captureFrame() {
    if (!videoElement) return null;

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    const context = canvas.getContext('2d');
    context.drawImage(videoElement, 0, 0);
    return canvas;
}

export function stopCamera() {
    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
    }
    if (videoElement) {
        videoElement.srcObject = null;
        videoElement = null;
    }
}

export function checkFrameQuality(canvas) {
    const context = canvas.getContext('2d');
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;

    const brightness = averageBrightness(data);
    if (brightness < MIN_BRIGHTNESS) return { ok: false, reason: 'Too dark' };
    if (brightness > MAX_BRIGHTNESS) return { ok: false, reason: 'Too bright' };

    const contrast = estimateContrast(data);
    if (contrast < MIN_CONTRAST) {
        return { ok: false, reason: 'Lighting is too flat' };
    }

    const sharpness = estimateSharpness(data, width, height);
    if (sharpness < MIN_SHARPNESS) return { ok: false, reason: 'Image is blurry' };

    return { ok: true };
}

function averageBrightness(data) {
    let sum = 0;
    const pixelCount = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    return sum / pixelCount;
}

function estimateContrast(data) {
    let sum = 0;
    let sumSquares = 0;
    const pixelCount = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
        const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += brightness;
        sumSquares += brightness * brightness;
    }

    const mean = sum / pixelCount;
    const variance = Math.max(sumSquares / pixelCount - mean * mean, 0);
    return Math.sqrt(variance);
}

function estimateSharpness(data, width, height) {
    let sum = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y += 4) {
        for (let x = 1; x < width - 1; x += 4) {
            const idx = (y * width + x) * 4;
            const center = data[idx] + data[idx + 1] + data[idx + 2];

            const left = data[idx - 4] + data[idx - 3] + data[idx - 2];
            const right = data[idx + 4] + data[idx + 5] + data[idx + 6];
            const top =
                data[idx - width * 4] + data[idx - width * 4 + 1] + data[idx - width * 4 + 2];
            const bottom =
                data[idx + width * 4] + data[idx + width * 4 + 1] + data[idx + width * 4 + 2];

            const laplacian = Math.abs(4 * center - left - right - top - bottom);
            sum += laplacian;
            count++;
        }
    }

    return count > 0 ? sum / count / 3 : 0;
}
