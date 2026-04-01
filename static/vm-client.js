let wasmModule = null;
let vmSession = null;
let challengeBundle = null;
let transport = null;

function loadScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${url}`));
        document.head.appendChild(script);
    });
}

export async function createSession() {
    const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            supportedTransports: buildTransportList(),
        }),
    });
    if (!response.ok) throw new Error('Failed to create session');
    vmSession = await response.json();
    return vmSession;
}

function buildTransportList() {
    const transports = [];
    if ('WebSocket' in window) transports.push('websocket');
    transports.push('poll');
    return transports;
}

export async function loadVM() {
    if (!vmSession) throw new Error('Call createSession first');

    await loadScript(vmSession.wasmJs);

    const loaderModule = await import(vmSession.loaderJs);
    wasmModule = await loaderModule.initModule(vmSession.wasmBin);

    const initFn = vmSession.exports.vm_init;
    const result = wasmModule[`_${initFn}`]();
    if (result !== 0) throw new Error('VM init failed');

    const bundleResponse = await fetch(vmSession.challengeVmbc);
    challengeBundle = new Uint8Array(await bundleResponse.arrayBuffer());
}

export async function decryptModel(modelId) {
    if (!wasmModule || !vmSession) throw new Error('VM not loaded');

    const modelInfo = vmSession.models[modelId];
    if (!modelInfo) throw new Error(`Unknown model: ${modelId}`);

    const response = await fetch(modelInfo.url);
    if (!response.ok) throw new Error(`Failed to fetch model: ${modelId}`);

    const encrypted = new Uint8Array(await response.arrayBuffer());

    const decryptFn = vmSession.exports.vm_decrypt_blob;
    const freeFn = vmSession.exports.vm_free;
    const length = encrypted.length;

    const inputPointer = wasmModule._malloc(length);
    wasmModule.HEAPU8.set(encrypted, inputPointer);

    const outLenPointer = wasmModule._malloc(4);
    const outPointer = wasmModule[`_${decryptFn}`](inputPointer, length, outLenPointer);
    wasmModule._free(inputPointer);

    if (!outPointer) {
        wasmModule._free(outLenPointer);
        throw new Error(`Decryption failed: ${modelId}`);
    }

    const outLength =
        wasmModule.HEAPU8[outLenPointer] |
        (wasmModule.HEAPU8[outLenPointer + 1] << 8) |
        (wasmModule.HEAPU8[outLenPointer + 2] << 16) |
        (wasmModule.HEAPU8[outLenPointer + 3] << 24);
    wasmModule._free(outLenPointer);

    const result = new Uint8Array(outLength);
    result.set(wasmModule.HEAPU8.subarray(outPointer, outPointer + outLength));
    wasmModule[`_${freeFn}`](outPointer);
    return result.buffer;
}

let _faceData = null;
let _challengeParams = null;
let _bridge = null;

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
    if (!wasmModule || !challengeBundle) throw new Error('VM not loaded');

    const execFn = vmSession.exports.vm_exec_bytecode;
    const freeFn = vmSession.exports.vm_free;
    const errFn = vmSession.exports.vm_last_error;
    const length = challengeBundle.length;

    const inputPointer = wasmModule._malloc(length);
    wasmModule.HEAPU8.set(challengeBundle, inputPointer);

    const outLenPointer = wasmModule._malloc(4);
    const outPointer = wasmModule[`_${execFn}`](inputPointer, length, outLenPointer);
    wasmModule._free(inputPointer);

    if (!outPointer) {
        wasmModule._free(outLenPointer);
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

    const outLength =
        wasmModule.HEAPU8[outLenPointer] |
        (wasmModule.HEAPU8[outLenPointer + 1] << 8) |
        (wasmModule.HEAPU8[outLenPointer + 2] << 16) |
        (wasmModule.HEAPU8[outLenPointer + 3] << 24);
    wasmModule._free(outLenPointer);

    const result = new Uint8Array(outLength);
    result.set(wasmModule.HEAPU8.subarray(outPointer, outPointer + outLength));
    wasmModule[`_${freeFn}`](outPointer);
    return result;
}

function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function openTransport() {
    if (!vmSession) throw new Error('No session');

    if (vmSession.transport === 'websocket') {
        transport = createWsTransport(vmSession.sessionId);
    } else {
        transport = createPollTransport(vmSession.sessionId);
    }
}

function createWsTransport(sessionId) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/api/ws/${sessionId}`;
    const ws = new WebSocket(url);
    let pending = [];
    let ready = false;
    let closed = false;

    const waitReady = new Promise((resolve, reject) => {
        ws.onopen = () => {
            ready = true;
            resolve();
        };
        ws.onerror = () => reject(new Error('WebSocket failed'));
    });

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        const resolver = pending.shift();
        if (resolver) resolver(message);
    };

    ws.onclose = () => {
        closed = true;
        for (const resolver of pending) resolver(null);
        pending = [];
    };

    return {
        receive() {
            if (closed) return Promise.resolve(null);
            return new Promise((resolve) => {
                pending.push(resolve);
            });
        },
        async send(data) {
            await waitReady;
            ws.send(JSON.stringify(data));
        },
        close() {
            closed = true;
            ws.close();
        },
        get isWebSocket() {
            return true;
        },
    };
}

function createPollTransport(sessionId) {
    return {
        async receive() {
            const response = await fetch(`/api/poll/${sessionId}`);
            if (!response.ok) throw new Error('Poll failed');
            return response.json();
        },
        send() {},
        close() {},
        get isWebSocket() {
            return false;
        },
    };
}

export async function getFirstChallenge() {
    return transport.receive();
}

export async function submitVerification(token, tokenSignature, vmResponse) {
    const payload = {
        token,
        tokenSignature,
        response: toBase64(vmResponse),
    };

    if (transport.isWebSocket) {
        await transport.send(payload);
        return transport.receive();
    }

    const response = await fetch(`/api/verify/${vmSession.sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('Verification failed');
    return response.json();
}

export function destroyVM() {
    if (transport) {
        transport.close();
        transport = null;
    }
    if (!wasmModule || !vmSession) return;
    const destroyFn = vmSession.exports.vm_destroy;
    wasmModule[`_${destroyFn}`]();
    wasmModule = null;
    vmSession = null;
    challengeBundle = null;
    _faceData = null;
    _challengeParams = null;
    _bridge = null;
    try {
        delete window.__vmFaceData;
    } catch (_) {}
    try {
        delete window.__vmChallenge;
    } catch (_) {}
    try {
        delete window.__vmBridge;
    } catch (_) {}
}

export function getSession() {
    return vmSession;
}
