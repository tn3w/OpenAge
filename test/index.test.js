import { describe, it, expect, vi, beforeEach } from 'vitest';

const createdWidgets = [];

vi.mock('../src/challenge.js', () => ({
    runChallenge: vi.fn(),
}));

vi.mock('../src/widget.js', () => {
    class MockWidget {
        constructor(container, params) {
            this.id = 'oa-test';
            this.params = params;
            this.state = 'idle';
            this.token = null;
            this.onChallenge = null;
            this.anchorElement = null;
            createdWidgets.push(this);
        }
        setStatus() {}
        setInstruction() {}
        setProgress() {}
        setTask() {}
        openPopup() {
            return null;
        }
        openModal() {
            return null;
        }
        closePopup() {}
        showResult() {}
        setState() {}
        getToken() {
            return this.token;
        }
        reset() {
            this.state = 'idle';
            this.token = null;
        }
        destroy() {}
        startChallenge() {
            if (this.onChallenge) this.onChallenge(this);
        }
    }
    return {
        Widget: MockWidget,
        createModalWidget: (p) =>
            new MockWidget(document.createElement('div'), {
                ...p,
                size: 'invisible',
            }),
    };
});

describe('index', () => {
    let OpenAge;

    beforeEach(async () => {
        createdWidgets.length = 0;
        vi.resetModules();
        const mod = await import('../src/index.js');
        OpenAge = mod.default;
    });

    it('exports version', () => {
        expect(OpenAge.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('has all API methods', () => {
        expect(typeof OpenAge.render).toBe('function');
        expect(typeof OpenAge.open).toBe('function');
        expect(typeof OpenAge.bind).toBe('function');
        expect(typeof OpenAge.reset).toBe('function');
        expect(typeof OpenAge.remove).toBe('function');
        expect(typeof OpenAge.getToken).toBe('function');
        expect(typeof OpenAge.execute).toBe('function');
        expect(typeof OpenAge.challenge).toBe('function');
        expect(typeof OpenAge.on).toBe('function');
        expect(typeof OpenAge.off).toBe('function');
        expect(typeof OpenAge.once).toBe('function');
        expect(typeof OpenAge.verify).toBe('function');
        expect(typeof OpenAge.decode).toBe('function');
    });

    it('render creates widget and returns id', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const id = OpenAge.render(container, {
            mode: 'serverless',
        });

        expect(typeof id).toBe('string');
        expect(id.startsWith('oa-')).toBe(true);
    });

    it('render auto-starts inline layout', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        OpenAge.render(container, {
            mode: 'serverless',
            layout: 'inline',
        });

        const challenge = await import('../src/challenge.js');

        expect(createdWidgets).toHaveLength(1);
        expect(createdWidgets[0].params.layout).toBe('inline');
        expect(challenge.runChallenge).toHaveBeenCalledTimes(1);
    });

    it('remove cleans up widget', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const id = OpenAge.render(container);
        OpenAge.remove(id);

        expect(OpenAge.getToken(id)).toBeNull();
    });

    it('reset clears widget state', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const id = OpenAge.render(container);
        OpenAge.reset(id);

        expect(OpenAge.getToken(id)).toBeNull();
    });

    it('bind throws for missing element', () => {
        expect(() => OpenAge.bind('#nonexistent', {})).toThrow('element not found');
    });

    it('bind anchors the popup to the target', () => {
        const target = document.createElement('button');
        document.body.appendChild(target);

        OpenAge.bind(target, { mode: 'serverless' });
        target.click();

        expect(createdWidgets).toHaveLength(1);
        expect(createdWidgets[0].anchorElement).toBe(target);
    });

    it('bind replays the original click only once', () => {
        const target = document.createElement('button');
        document.body.appendChild(target);

        let nativeClicks = 0;
        target.addEventListener('click', () => {
            nativeClicks++;
        });

        OpenAge.bind(target, { mode: 'serverless' });
        target.click();

        expect(nativeClicks).toBe(0);
        expect(createdWidgets).toHaveLength(1);

        createdWidgets[0].params.callback?.('token');

        expect(nativeClicks).toBe(1);
        expect(createdWidgets).toHaveLength(1);
    });

    it('on / off register and remove handlers', () => {
        const calls = [];
        const handler = () => calls.push('called');

        OpenAge.on('verified', handler);
        OpenAge.off('verified', handler);
    });
});
