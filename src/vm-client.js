let wasmModule = null;
let vmSession = null;
let challengeBundle = null;
let _faceData = null;
let _challengeParams = null;
let _bridge = null;

function loadScript(url) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${url}"]`);
        if (existing) return resolve();

        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => {
            reject(new Error(`Failed to load ${url}`));
        };
        document.head.appendChild(script);
    });
}

export async function initVM(session) {
    vmSession = session;

    await loadScript(session.wasmJs);

    const loaderModule = await import(session.loaderJs);
    wasmModule = await loaderModule.initModule(session.wasmBin);

    const initFn = session.exports.vm_init;
    const result = wasmModule[`_${initFn}`]();
    if (result !== 0) throw new Error('VM init failed');

    const bundleResponse = await fetch(session.challengeVmbc);
    challengeBundle = new Uint8Array(await bundleResponse.arrayBuffer());
}

export async function decryptModel(session, modelId) {
    if (!wasmModule || !vmSession) {
        throw new Error('VM not loaded');
    }

    const modelInfo = session.models[modelId];
    if (!modelInfo) {
        throw new Error(`Unknown model: ${modelId}`);
    }

    const response = await fetch(modelInfo.url);
    if (!response.ok) {
        throw new Error(`Failed to fetch model: ${modelId}`);
    }

    const encrypted = new Uint8Array(await response.arrayBuffer());

    const decryptFn = session.exports.vm_decrypt_blob;
    const freeFn = session.exports.vm_free;
    const length = encrypted.length;

    const inputPtr = wasmModule._malloc(length);
    wasmModule.HEAPU8.set(encrypted, inputPtr);

    const outLenPtr = wasmModule._malloc(4);
    const outPtr = wasmModule[`_${decryptFn}`](inputPtr, length, outLenPtr);
    wasmModule._free(inputPtr);

    if (!outPtr) {
        wasmModule._free(outLenPtr);
        throw new Error(`Decryption failed: ${modelId}`);
    }

    const outLen = readU32(wasmModule, outLenPtr);
    wasmModule._free(outLenPtr);

    const result = new Uint8Array(outLen);
    result.set(wasmModule.HEAPU8.subarray(outPtr, outPtr + outLen));
    wasmModule[`_${freeFn}`](outPtr);
    return result.buffer;
}

function readU32(mod, ptr) {
    return (
        mod.HEAPU8[ptr] |
        (mod.HEAPU8[ptr + 1] << 8) |
        (mod.HEAPU8[ptr + 2] << 16) |
        (mod.HEAPU8[ptr + 3] << 24)
    );
}

function defineVmGlobal(name, getter) {
    try {
        delete window[name];
    } catch (_) {}
    Object.defineProperty(window, name, {
        get: getter,
        set() {},
        configurable: true,
    });
}

export function setFaceData(faceData) {
    _faceData = faceData;
    defineVmGlobal('__vmFaceData', () => _faceData);
}

export function setChallengeParams(params) {
    _challengeParams = params;
    defineVmGlobal('__vmChallenge', () => _challengeParams);
}

export function registerBridge(bridge) {
    _bridge = Object.freeze({ ...bridge });
    defineVmGlobal('__vmBridge', () => _bridge);
}

export function unregisterBridge() {
    _bridge = null;
    try {
        delete window.__vmBridge;
    } catch (_) {}
}

export function executeChallenge() {
    if (!wasmModule || !challengeBundle) {
        throw new Error('VM not loaded');
    }

    const execFn = vmSession.exports.vm_exec_bytecode;
    const freeFn = vmSession.exports.vm_free;
    const length = challengeBundle.length;

    const inputPtr = wasmModule._malloc(length);
    wasmModule.HEAPU8.set(challengeBundle, inputPtr);

    const outLenPtr = wasmModule._malloc(4);
    const outPtr = wasmModule[`_${execFn}`](inputPtr, length, outLenPtr);
    wasmModule._free(inputPtr);

    if (!outPtr) {
        wasmModule._free(outLenPtr);
        const errFn = vmSession.exports.vm_last_error;
        let message = 'VM execution failed';
        if (errFn) {
            const errPtr = wasmModule[`_${errFn}`]();
            if (errPtr) {
                const detail = wasmModule.UTF8ToString(errPtr);
                if (detail) message = detail;
            }
        }
        throw new Error(message);
    }

    const outLen = readU32(wasmModule, outLenPtr);
    wasmModule._free(outLenPtr);

    const result = new Uint8Array(outLen);
    result.set(wasmModule.HEAPU8.subarray(outPtr, outPtr + outLen));
    wasmModule[`_${freeFn}`](outPtr);
    return result;
}

export function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function destroyVM() {
    if (!wasmModule || !vmSession) return;

    const destroyFn = vmSession.exports.vm_destroy;
    if (destroyFn) {
        wasmModule[`_${destroyFn}`]();
    }

    wasmModule = null;
    vmSession = null;
    challengeBundle = null;
    _faceData = null;
    _challengeParams = null;
    _bridge = null;

    for (const name of ['__vmFaceData', '__vmChallenge', '__vmBridge']) {
        try {
            delete window[name];
        } catch (_) {}
    }
}

export function isVMLoaded() {
    return wasmModule !== null && vmSession !== null;
}

const decryptedCache = new Map();

async function decryptAndCache(session, modelId) {
    if (decryptedCache.has(modelId)) {
        return decryptedCache.get(modelId);
    }

    const buffer = await decryptModel(session, modelId);
    decryptedCache.set(modelId, buffer);
    return buffer;
}

export async function ensureModels(session, onProgress) {
    await decryptAndCache(session, 'mediapipe');
    onProgress?.(1);
}

export async function getMediaPipeModelBuffer(session) {
    return decryptAndCache(session, 'mediapipe');
}

export function clearModelCache() {
    decryptedCache.clear();
}
