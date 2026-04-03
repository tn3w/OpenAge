import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTransport } from '../src/transport.js';

describe('createTransport', () => {
    describe('serverless mode', () => {
        it('verifies passing age', async () => {
            const transport = createTransport('serverless', {
                minAge: 18,
            });

            const result = await transport.verify({
                estimatedAge: 25,
                livenessOk: true,
            });

            expect(result.success).toBe(true);
            expect(result.ageConfirmed).toBe(true);
            expect(result.token).toBeTruthy();
        });

        it('rejects failing age', async () => {
            const transport = createTransport('serverless', {
                minAge: 18,
            });

            const result = await transport.verify({
                estimatedAge: 14,
                livenessOk: true,
            });

            expect(result.success).toBe(true);
            expect(result.ageConfirmed).toBe(false);
        });

        it('rejects failed liveness', async () => {
            const transport = createTransport('serverless');

            const result = await transport.verify({
                estimatedAge: 25,
                livenessOk: false,
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('liveness_failed');
        });

        it('uses default minAge of 18', async () => {
            const transport = createTransport('serverless');

            const result = await transport.verify({
                estimatedAge: 19,
                livenessOk: true,
            });

            expect(result.ageConfirmed).toBe(true);
        });
    });

    describe('custom mode', () => {
        it('creates transport with custom server', () => {
            const transport = createTransport('custom', {
                server: 'https://example.com/verify',
            });

            expect(transport.verify).toBeDefined();
            expect(transport.close).toBeDefined();
        });
    });

    describe('sitekey mode', () => {
        it('creates transport with session support', () => {
            const transport = createTransport('sitekey', {
                sitekey: 'test_key',
            });

            expect(transport.verify).toBeDefined();
            expect(transport.createSession).toBeDefined();
            expect(transport.openChannel).toBeDefined();
            expect(transport.close).toBeDefined();
        });

        it('getSession returns null initially', () => {
            const transport = createTransport('sitekey', {
                sitekey: 'test_key',
            });

            expect(transport.getSession()).toBeNull();
        });
    });
});
