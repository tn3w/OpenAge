import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Widget, createModalWidget } from '../src/widget.js';

function setRect(element, rect) {
    element.getBoundingClientRect = vi.fn(() => ({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        toJSON() {},
    }));
}

describe('Widget', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('creates with unique id', () => {
        const w1 = new Widget(container, { size: 'normal' });
        const w2 = new Widget(container, { size: 'normal' });
        expect(w1.id).not.toBe(w2.id);
    });

    it('starts in idle state', () => {
        const widget = new Widget(container, {});
        expect(widget.state).toBe('idle');
    });

    it('token is null initially', () => {
        const widget = new Widget(container, {});
        expect(widget.getToken()).toBeNull();
    });

    it('renders checkbox with shadow DOM', () => {
        const widget = new Widget(container, {});
        const host = container.querySelector(`#${widget.id}`);
        expect(host).toBeTruthy();
        expect(host.shadowRoot).toBeTruthy();
    });

    it('renders compact variant', () => {
        const widget = new Widget(container, {
            size: 'compact',
        });
        const checkbox = widget.shadow.querySelector('.oa-checkbox');
        expect(checkbox.classList.contains('oa-compact')).toBe(true);
    });

    it('invisible widget has display none', () => {
        const widget = new Widget(container, {
            size: 'invisible',
        });
        expect(widget.host.style.display).toBe('none');
    });

    it('reset returns to idle', () => {
        const widget = new Widget(container, {});
        widget.setState('verified');
        widget.reset();
        expect(widget.state).toBe('idle');
        expect(widget.token).toBeNull();
    });

    it('destroy removes from DOM', () => {
        const widget = new Widget(container, {});
        const id = widget.id;
        widget.destroy();
        expect(container.querySelector(`#${id}`)).toBeNull();
    });

    it('setState changes checkbox appearance', () => {
        const widget = new Widget(container, {});
        widget.setState('verified');

        const checkbox = widget.shadow.querySelector('.oa-checkbox');
        expect(checkbox.classList.contains('oa-verified')).toBe(true);
        expect(checkbox.getAttribute('aria-checked')).toBe('true');
    });

    it('onChallenge fires on click', () => {
        const widget = new Widget(container, {});
        const spy = vi.fn();
        widget.onChallenge = spy;

        const checkbox = widget.shadow.querySelector('.oa-checkbox');
        checkbox.click();

        expect(spy).toHaveBeenCalledWith(widget);
    });

    it('normal widget fail only shows retry state', () => {
        const widget = new Widget(container, {});

        widget.showResult('fail', 'Verification failed');

        const checkbox = widget.shadow.querySelector('.oa-checkbox');

        expect(widget.state).toBe('retry');
        expect(checkbox.classList.contains('oa-retry')).toBe(true);
        expect(widget.elements.checkBox.innerHTML).toContain('14.955 7.986');
        expect(widget.elements.errorSlot.innerHTML).toBe('');
    });

    it('normal widget retry closes popup and marks retry state', () => {
        const widget = new Widget(container, {});
        setRect(widget.elements.checkbox, {
            top: 100,
            right: 320,
            bottom: 140,
            left: 200,
            width: 120,
            height: 40,
        });

        widget.openPopup();
        widget.showResult('retry', 'Please try again');

        expect(widget.popup).toBeNull();
        expect(widget.state).toBe('retry');
    });

    it('anchors popup below the checkbox', () => {
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 900,
        });
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 900,
        });

        const widget = new Widget(container, {});
        setRect(widget.elements.checkbox, {
            top: 100,
            right: 320,
            bottom: 140,
            left: 200,
            width: 120,
            height: 40,
        });

        widget.openPopup();

        expect(widget.popup.overlay).toBeUndefined();
        expect(widget.popup.root.style.top).toBe('152px');
        expect(widget.popup.root.style.left).toBe('90px');
        expect(widget.popup.root.dataset.placement).toBe('below');
    });

    it('updates popup position after reflow events', async () => {
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 900,
        });
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 900,
        });

        const widget = new Widget(container, {});
        const rect = {
            top: 120,
            right: 320,
            bottom: 160,
            left: 200,
            width: 120,
            height: 40,
        };

        setRect(widget.elements.checkbox, rect);
        widget.openPopup();

        rect.top = 280;
        rect.bottom = 320;
        rect.left = 260;
        rect.right = 380;

        window.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => {
            requestAnimationFrame(() => resolve());
        });

        expect(widget.popup.root.style.top).toBe('332px');
        expect(widget.popup.root.style.left).toBe('150px');
    });
});

describe('createModalWidget', () => {
    it('creates invisible widget for modal', () => {
        const widget = createModalWidget({ mode: 'serverless' });
        expect(widget.params.size).toBe('invisible');
    });

    it('uses an external anchor when provided', () => {
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 900,
        });
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 900,
        });

        const target = document.createElement('button');
        document.body.appendChild(target);
        setRect(target, {
            top: 160,
            right: 380,
            bottom: 200,
            left: 260,
            width: 120,
            height: 40,
        });

        const widget = createModalWidget({ mode: 'serverless' });
        widget.anchorElement = target;
        widget.openPopup();

        expect(widget.popup.overlay).toBeUndefined();
        expect(widget.popup.root.style.top).toBe('212px');
        expect(widget.popup.root.style.left).toBe('150px');
    });
});
