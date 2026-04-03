import { describe, it, expect } from 'vitest';
import { createToken, verifyToken, decodeToken } from '../src/transport.js';

describe('token', () => {
    it('creates and verifies a token', async () => {
        const token = await createToken({
            ageConfirmed: true,
            estimatedAge: 25,
        });

        expect(typeof token).toBe('string');
        expect(token.split('.').length).toBe(3);

        const payload = await verifyToken(token);
        expect(payload).not.toBeNull();
        expect(payload.ageConfirmed).toBe(true);
        expect(payload.estimatedAge).toBe(25);
        expect(payload.iat).toBeDefined();
        expect(payload.exp).toBeDefined();
    });

    it('rejects tampered token', async () => {
        const token = await createToken({ data: 'test' });
        const parts = token.split('.');
        parts[1] = parts[1] + 'x';
        const tampered = parts.join('.');

        const result = await verifyToken(tampered);
        expect(result).toBeNull();
    });

    it('rejects malformed token', async () => {
        const result = await verifyToken('not.a.valid');
        expect(result).toBeNull();
    });

    it('rejects token without parts', async () => {
        const result = await verifyToken('incomplete');
        expect(result).toBeNull();
    });

    it('decodes without verification', async () => {
        const token = await createToken({
            mode: 'serverless',
        });
        const payload = decodeToken(token);

        expect(payload).not.toBeNull();
        expect(payload.mode).toBe('serverless');
    });

    it('decodeToken returns null for invalid', () => {
        expect(decodeToken('bad')).toBeNull();
    });
});
