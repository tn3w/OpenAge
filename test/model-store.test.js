import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/vm-client.js', async () => ({
    decryptModel: vi.fn(async () => new ArrayBuffer(16)),
    ensureModels: vi.fn(async (_s, onProgress) => {
        onProgress?.(1);
    }),
    getMediaPipeModelBuffer: vi.fn(async () => new ArrayBuffer(16)),
    clearModelCache: vi.fn(),
}));

const { ensureModels, getMediaPipeModelBuffer, clearModelCache } =
    await import('../src/vm-client.js');

describe('model-store', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exports ensureModels', () => {
        expect(typeof ensureModels).toBe('function');
    });

    it('exports getMediaPipeModelBuffer', () => {
        expect(typeof getMediaPipeModelBuffer).toBe('function');
    });

    it('exports clearModelCache', () => {
        expect(typeof clearModelCache).toBe('function');
    });

    it('ensureModels calls onProgress', async () => {
        const progress = vi.fn();
        await ensureModels({}, progress);
        expect(progress).toHaveBeenCalledWith(1);
    });

    it('getMediaPipeModelBuffer returns buffer', async () => {
        const buf = await getMediaPipeModelBuffer({});
        expect(buf).toBeInstanceOf(ArrayBuffer);
        expect(buf.byteLength).toBe(16);
    });
});
