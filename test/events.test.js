import { describe, it, expect } from 'vitest';
import { EventEmitter } from '../src/index.js';

describe('EventEmitter', () => {
    it('calls registered handler on emit', () => {
        const emitter = new EventEmitter();
        const calls = [];

        emitter.on('test', (value) => calls.push(value));
        emitter.emit('test', 'hello');

        expect(calls).toEqual(['hello']);
    });

    it('supports multiple handlers', () => {
        const emitter = new EventEmitter();
        const calls = [];

        emitter.on('x', () => calls.push('a'));
        emitter.on('x', () => calls.push('b'));
        emitter.emit('x');

        expect(calls).toEqual(['a', 'b']);
    });

    it('removes handler with off', () => {
        const emitter = new EventEmitter();
        const calls = [];
        const handler = () => calls.push('hit');

        emitter.on('e', handler);
        emitter.off('e', handler);
        emitter.emit('e');

        expect(calls).toEqual([]);
    });

    it('fires once handler only once', () => {
        const emitter = new EventEmitter();
        const calls = [];

        emitter.once('e', () => calls.push('once'));
        emitter.emit('e');
        emitter.emit('e');

        expect(calls).toEqual(['once']);
    });

    it('does nothing when emitting unknown event', () => {
        const emitter = new EventEmitter();
        expect(() => emitter.emit('nope')).not.toThrow();
    });

    it('removeAllListeners clears specific event', () => {
        const emitter = new EventEmitter();
        const calls = [];

        emitter.on('a', () => calls.push('a'));
        emitter.on('b', () => calls.push('b'));
        emitter.removeAllListeners('a');
        emitter.emit('a');
        emitter.emit('b');

        expect(calls).toEqual(['b']);
    });

    it('removeAllListeners clears all events', () => {
        const emitter = new EventEmitter();
        const calls = [];

        emitter.on('a', () => calls.push('a'));
        emitter.on('b', () => calls.push('b'));
        emitter.removeAllListeners();
        emitter.emit('a');
        emitter.emit('b');

        expect(calls).toEqual([]);
    });

    it('passes multiple arguments', () => {
        const emitter = new EventEmitter();
        let received = [];

        emitter.on('multi', (...args) => {
            received = args;
        });
        emitter.emit('multi', 1, 2, 3);

        expect(received).toEqual([1, 2, 3]);
    });

    it('returns this from on/off/once for chaining', () => {
        const emitter = new EventEmitter();
        const handler = () => {};

        expect(emitter.on('e', handler)).toBe(emitter);
        expect(emitter.off('e', handler)).toBe(emitter);
        expect(emitter.once('e', handler)).toBe(emitter);
    });
});
