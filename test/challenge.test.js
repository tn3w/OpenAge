import { describe, it, expect, vi } from 'vitest';
import { runChallenge } from '../src/challenge.js';
import { EventEmitter } from '../src/index.js';

describe('challenge module', () => {
    it('exports runChallenge function', () => {
        expect(typeof runChallenge).toBe('function');
    });

    it('emits error on challenge failure', async () => {
        const emitter = new EventEmitter();
        const errors = [];

        emitter.on('error', (err) => errors.push(err));

        const widget = {
            params: { mode: 'serverless' },
            popup: null,
            popupElements: null,
            setHeroStatus: vi.fn(),
            setVideoStatus: vi.fn(),
            setInstruction: vi.fn(),
            setProgress: vi.fn(),
            setTask: vi.fn(),
            openPopup: vi.fn(),
            showHero: vi.fn(),
            showReady: vi.fn(),
            showCamera: () => null,
            showLiveness: vi.fn(),
            showResult: vi.fn(),
            showActions: vi.fn(),
            hideActions: vi.fn(),
            closePopup: vi.fn(),
            onStartClick: null,
        };

        widget.openPopup.mockImplementation(() => {
            widget.popup = { root: {} };
            widget.popupElements = {};
        });

        widget.showReady.mockImplementation(() => {
            if (widget.onStartClick) widget.onStartClick();
        });

        await runChallenge(widget, emitter);

        expect(errors.length).toBeGreaterThan(0);
    });
});
