import { decryptModel } from './vm-client.js';

const decryptedCache = new Map();

async function decryptAndCache(modelId) {
    if (decryptedCache.has(modelId)) return decryptedCache.get(modelId);

    const buffer = await decryptModel(modelId);
    decryptedCache.set(modelId, buffer);
    return buffer;
}

export async function ensureModels(onProgress) {
    await decryptAndCache('mediapipe');
    onProgress?.(1);
}

export async function getMediaPipeModelBuffer() {
    return decryptAndCache('mediapipe');
}

export async function clearCache() {
    decryptedCache.clear();
}

export function installCacheInterceptor() {}
