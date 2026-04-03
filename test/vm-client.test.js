import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/vm-client.js', async () => {
    const fakeModule = {
        _malloc: vi.fn(() => 100),
        _free: vi.fn(),
        HEAPU8: new Uint8Array(256),
    };

    return {
        initVM: vi.fn(),
        decryptModel: vi.fn(async () => new ArrayBuffer(8)),
        setFaceData: vi.fn(),
        setChallengeParams: vi.fn(),
        registerBridge: vi.fn(),
        unregisterBridge: vi.fn(),
        executeChallenge: vi.fn(() => new Uint8Array([1, 2, 3])),
        toBase64: vi.fn(() => 'AQID'),
        destroyVM: vi.fn(),
        isVMLoaded: vi.fn(() => false),
        ensureModels: vi.fn(),
        getMediaPipeModelBuffer: vi.fn(async () => new ArrayBuffer(16)),
        clearModelCache: vi.fn(),
    };
});

const vmClient = await import('../src/vm-client.js');

describe('vm-client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exports initVM', () => {
        expect(typeof vmClient.initVM).toBe('function');
    });

    it('exports decryptModel', () => {
        expect(typeof vmClient.decryptModel).toBe('function');
    });

    it('exports setFaceData', () => {
        expect(typeof vmClient.setFaceData).toBe('function');
    });

    it('exports setChallengeParams', () => {
        expect(typeof vmClient.setChallengeParams).toBe('function');
    });

    it('exports registerBridge', () => {
        expect(typeof vmClient.registerBridge).toBe('function');
    });

    it('exports unregisterBridge', () => {
        expect(typeof vmClient.unregisterBridge).toBe('function');
    });

    it('exports executeChallenge', () => {
        expect(typeof vmClient.executeChallenge).toBe('function');
    });

    it('exports toBase64', () => {
        expect(vmClient.toBase64()).toBe('AQID');
    });

    it('exports destroyVM', () => {
        expect(typeof vmClient.destroyVM).toBe('function');
    });

    it('exports isVMLoaded', () => {
        expect(vmClient.isVMLoaded()).toBe(false);
    });

    it('decryptModel returns ArrayBuffer', async () => {
        const buf = await vmClient.decryptModel({ models: {} }, 'test');
        expect(buf).toBeInstanceOf(ArrayBuffer);
    });

    it('exports ensureModels', () => {
        expect(typeof vmClient.ensureModels).toBe('function');
    });

    it('exports getMediaPipeModelBuffer', () => {
        expect(typeof vmClient.getMediaPipeModelBuffer).toBe('function');
    });

    it('exports clearModelCache', () => {
        expect(typeof vmClient.clearModelCache).toBe('function');
    });
});
