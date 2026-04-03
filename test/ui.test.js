import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    resolveTheme,
    watchTheme,
    checkboxTemplate,
    heroTemplate,
    challengeTemplate,
    resultTemplate,
    FACE_SVG,
    FACE_GUIDE_SVG,
    CHECK_SVG,
    CLOSE_SVG,
    RETRY_SVG,
    SPINNER_SVG,
    SHIELD_SVG,
    STYLES,
} from '../src/ui.js';

const originalMatchMedia = window.matchMedia;
const originalGetComputedStyle = window.getComputedStyle;
const originalMutationObserver = globalThis.MutationObserver;

let observerCallback = null;

function mockMatchMedia(resolver) {
    window.matchMedia = vi.fn((query) => ({
        matches: resolver(query),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
}

beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    document.documentElement.style.backgroundColor = '';
    document.body.className = '';
    document.body.removeAttribute('data-theme');
    document.body.style.colorScheme = '';
    document.body.style.backgroundColor = '';
    observerCallback = null;
});

afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.getComputedStyle = originalGetComputedStyle;
    globalThis.MutationObserver = originalMutationObserver;
});

describe('resolveTheme', () => {
    it('returns light for light', () => {
        expect(resolveTheme('light')).toBe('light');
    });

    it('returns dark for dark', () => {
        expect(resolveTheme('dark')).toBe('dark');
    });

    it('returns a valid theme for auto', () => {
        const result = resolveTheme('auto');
        expect(['light', 'dark']).toContain(result);
    });

    it('prefers an explicit dark document color scheme', () => {
        document.documentElement.style.colorScheme = 'dark';
        mockMatchMedia((query) => query.includes('light'));

        expect(resolveTheme('auto')).toBe('dark');
    });

    it('falls back to a dark page background', () => {
        mockMatchMedia((query) => query.includes('light'));

        window.getComputedStyle = vi.fn((element) => {
            if (element === document.body) {
                return {
                    colorScheme: 'normal',
                    backgroundColor: 'rgb(13, 17, 23)',
                };
            }

            return {
                colorScheme: 'normal',
                backgroundColor: 'transparent',
            };
        });

        expect(resolveTheme('auto')).toBe('dark');
    });
});

describe('watchTheme', () => {
    it('updates the host from document theme hints', () => {
        const host = document.createElement('div');
        document.documentElement.style.colorScheme = 'dark';
        mockMatchMedia(() => false);
        globalThis.MutationObserver = class {
            constructor(callback) {
                observerCallback = callback;
            }

            observe() {}

            disconnect() {}
        };

        const cleanup = watchTheme(host, 'auto');

        document.documentElement.style.colorScheme = 'light';
        observerCallback?.();

        expect(host.getAttribute('data-theme')).toBe('light');

        cleanup?.();
    });
});

describe('templates', () => {
    it('checkboxTemplate contains label', () => {
        const html = checkboxTemplate('I am of age');
        expect(html).toContain('I am of age');
        expect(html).toContain('OpenAge');
        expect(html).toContain('oa-checkbox');
    });

    it('heroTemplate shows status and privacy', () => {
        const html = heroTemplate('Loading…');
        expect(html).toContain('Loading…');
        expect(html).toContain('oa-hero');
        expect(html).toContain('privacy-focused');
        expect(html).toContain('No photos');
    });

    it('challengeTemplate has video and guide', () => {
        const html = challengeTemplate();
        expect(html).toContain('video');
        expect(html).toContain('oa-face-guide');
        expect(html).toContain('oa-challenge-hud');
        expect(html).toContain('stroke-dasharray');
    });

    it('resultTemplate shows fail outcome', () => {
        const html = resultTemplate('fail', 'Failed');
        expect(html).toContain('✕');
        expect(html).toContain('oa-result-fail');
    });

    it('resultTemplate shows retry outcome', () => {
        const html = resultTemplate('retry', 'Try again');
        expect(html).toContain('↻');
        expect(html).toContain('oa-result-retry');
    });
});

describe('SVG constants', () => {
    it('FACE_SVG contains ellipse', () => {
        expect(FACE_SVG).toContain('ellipse');
    });

    it('FACE_GUIDE_SVG has dashed stroke', () => {
        expect(FACE_GUIDE_SVG).toContain('stroke-dasharray');
    });

    it('CHECK_SVG contains polyline', () => {
        expect(CHECK_SVG).toContain('polyline');
    });

    it('CLOSE_SVG contains line', () => {
        expect(CLOSE_SVG).toContain('line');
    });

    it('RETRY_SVG contains the provided retry path', () => {
        expect(RETRY_SVG).toContain('viewBox="0 0 16 16"');
        expect(RETRY_SVG).toContain('14.955 7.986');
    });

    it('SPINNER_SVG contains animateTransform', () => {
        expect(SPINNER_SVG).toContain('animateTransform');
    });

    it('SHIELD_SVG contains path', () => {
        expect(SHIELD_SVG).toContain('path');
    });
});

describe('STYLES', () => {
    it('contains CSS custom properties', () => {
        expect(STYLES).toContain('--oa-bg');
        expect(STYLES).toContain('--oa-accent');
        expect(STYLES).toContain('--oa-text');
    });

    it('contains light theme override', () => {
        expect(STYLES).toContain('[data-theme="light"]');
    });

    it('contains animation keyframes', () => {
        expect(STYLES).toContain('@keyframes oa-turn-left');
        expect(STYLES).toContain('@keyframes oa-nod');
        expect(STYLES).toContain('@keyframes oa-blink');
        expect(STYLES).toContain('@keyframes oa-breathe');
    });

    it('contains hero and challenge HUD styles', () => {
        expect(STYLES).toContain('oa-hero');
        expect(STYLES).toContain('oa-challenge-hud');
        expect(STYLES).toContain('oa-video-status');
    });
});
