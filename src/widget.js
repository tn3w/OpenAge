import {
    STYLES,
    checkboxTemplate,
    heroTemplate,
    challengeTemplate,
    errorStepTemplate,
    resultTemplate,
    resolveTheme,
    watchTheme,
    SPINNER_SVG,
    CHECK_SVG,
    CLOSE_SVG,
    RETRY_SVG,
} from './ui.js';
import { POPUP_MIN_WIDTH, POPUP_MIN_HEIGHT, POPUP_MARGIN } from './constants.js';

let widgetCounter = 0;

export class Widget {
    constructor(container, params) {
        this.id = `oa-${++widgetCounter}`;
        this.params = params;
        this.container = resolveContainer(container);
        this.anchorElement = null;
        this.state = 'idle';
        this.token = null;
        this.popup = null;
        this.shadow = null;
        this.elements = {};
        this.popupElements = null;
        this.onChallenge = null;
        this.onStartClick = null;
        this.popupFrame = 0;
        this.themeCleanup = null;

        this.render();
    }

    render() {
        const host = document.createElement('div');
        host.id = this.id;
        this.shadow = host.attachShadow({ mode: 'open' });
        this.host = host;

        const style = document.createElement('style');
        style.textContent = STYLES;
        this.shadow.appendChild(style);

        const theme = resolveTheme(this.params.theme);
        host.setAttribute('data-theme', theme);
        this.themeCleanup = watchTheme(host, this.params.theme);

        if (this.params.size === 'invisible') {
            host.style.display = 'none';
            this.container.appendChild(host);
            return;
        }

        if (this.isInlineLayout()) {
            this.renderInlineShell();
            this.container.appendChild(host);
            return;
        }

        const label = 'I am of age';

        const wrapper = document.createElement('div');
        wrapper.innerHTML = checkboxTemplate(label);
        this.shadow.appendChild(wrapper.firstElementChild);

        const checkbox = this.shadow.querySelector('.oa-checkbox');

        if (this.params.size === 'compact') {
            checkbox.classList.add('oa-compact');
        }

        checkbox.addEventListener('click', (event) => {
            if (event.target.closest('a')) return;
            if (this.state === 'verified') return;
            if (this.state === 'loading') return;
            this.clearError();
            this.startChallenge();
        });

        checkbox.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                checkbox.click();
            }
        });

        this.elements.checkbox = checkbox;
        this.elements.checkBox = this.shadow.querySelector('.oa-check-box');
        this.elements.errorSlot = this.shadow.querySelector('.oa-error-slot');

        this.container.appendChild(host);
    }

    isInlineLayout() {
        return this.params.layout === 'inline';
    }

    renderInlineShell() {
        const inlineShell = document.createElement('div');
        inlineShell.className = 'oa-inline-shell';
        inlineShell.innerHTML = this.buildPopupContent({ closeable: false });
        this.shadow.appendChild(inlineShell);

        this.popup = {
            host: this.host,
            root: inlineShell,
            inline: true,
        };

        this.bindPopupEvents(inlineShell);
    }

    resetInlineShell() {
        if (!this.popup?.root) return;

        this.popup.root.innerHTML = this.buildPopupContent({ closeable: false });
        this.bindPopupEvents(this.popup.root);
    }

    startChallenge() {
        this.setState('loading');

        if (this.onChallenge) {
            this.onChallenge(this);
        }
    }

    createPopupShell() {
        const theme = resolveTheme(this.params.theme);
        const popupHost = document.createElement('div');
        popupHost.setAttribute('data-theme', theme);
        const popupShadow = popupHost.attachShadow({
            mode: 'open',
        });

        const style = document.createElement('style');
        style.textContent = STYLES;
        popupShadow.appendChild(style);

        const themeCleanup = watchTheme(popupHost, this.params.theme);

        return {
            popupHost,
            popupShadow,
            themeCleanup,
        };
    }

    openPopup() {
        if (this.isInlineLayout()) {
            if (!this.popup) {
                this.renderInlineShell();
            }

            return this.getVideo();
        }

        if (this.popup) return this.getVideo();

        const anchor = this.getPopupAnchor();

        if (!anchor) {
            return this.openModal();
        }

        const { popupHost, popupShadow, themeCleanup } = this.createPopupShell();

        const popup = document.createElement('div');
        popup.className = 'oa-popup';
        popup.innerHTML = this.buildPopupContent();
        popup.style.visibility = 'hidden';
        popup.style.pointerEvents = 'none';

        popupShadow.appendChild(popup);
        document.body.appendChild(popupHost);

        this.popup = {
            anchor,
            host: popupHost,
            root: popup,
            themeCleanup,
        };

        const anchorRect = anchor.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        const position = findPopupPosition(anchorRect, popupRect);

        if (position.mode === 'modal') {
            popupHost.remove();
            themeCleanup?.();
            this.popup = null;
            return this.openModal();
        }

        this.bindPopupEvents(popup, popupShadow);
        this.updatePopupPosition();
        this.startPopupTracking();
        return this.getVideo();
    }

    openModal() {
        const { popupHost, popupShadow, themeCleanup } = this.createPopupShell();

        const overlay = document.createElement('div');
        overlay.className = 'oa-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'oa-modal';
        modal.innerHTML = this.buildPopupContent();

        overlay.appendChild(modal);
        popupShadow.appendChild(overlay);
        document.body.appendChild(popupHost);

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) this.closePopup();
        });

        this.popup = {
            host: popupHost,
            root: modal,
            overlay,
            themeCleanup,
        };
        this.bindPopupEvents(modal, popupShadow);
        return this.getVideo();
    }

    getPopupAnchor() {
        return this.anchorElement || this.elements.checkbox || this.host || null;
    }

    startPopupTracking() {
        if (!this.popup || this.popup.overlay) return;

        const schedule = () => {
            this.schedulePopupPosition();
        };

        const cleanups = [];
        const addWindowListener = (name, options) => {
            window.addEventListener(name, schedule, options);
            cleanups.push(() => {
                window.removeEventListener(name, schedule, options);
            });
        };

        addWindowListener('resize', { passive: true });
        addWindowListener('scroll', {
            capture: true,
            passive: true,
        });

        if (window.visualViewport) {
            const viewport = window.visualViewport;
            viewport.addEventListener('resize', schedule);
            viewport.addEventListener('scroll', schedule);
            cleanups.push(() => {
                viewport.removeEventListener('resize', schedule);
                viewport.removeEventListener('scroll', schedule);
            });
        }

        if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(() => {
                schedule();
            });
            observer.observe(this.popup.root);
            observer.observe(this.popup.anchor);
            observer.observe(document.documentElement);
            if (document.body) {
                observer.observe(document.body);
            }
            cleanups.push(() => observer.disconnect());
        }

        this.popup.cleanup = () => {
            if (this.popupFrame) {
                cancelAnimationFrame(this.popupFrame);
                this.popupFrame = 0;
            }
            for (const cleanup of cleanups) {
                cleanup();
            }
        };
    }

    schedulePopupPosition() {
        if (!this.popup || this.popup.overlay) return;
        if (this.popupFrame) return;

        this.popupFrame = requestAnimationFrame(() => {
            this.popupFrame = 0;
            this.updatePopupPosition();
        });
    }

    updatePopupPosition() {
        if (!this.popup || this.popup.overlay) return;

        const anchor = this.getPopupAnchor();
        if (!anchor || !anchor.isConnected) {
            this.closePopup();
            return;
        }

        this.popup.anchor = anchor;

        const anchorRect = anchor.getBoundingClientRect();
        const popupRect = this.popup.root.getBoundingClientRect();
        const position = findPopupPosition(anchorRect, popupRect);

        if (position.mode === 'modal') {
            this.closePopup();
            this.openModal();
            return;
        }

        const top = `${Math.round(position.top)}px`;
        const left = `${Math.round(position.left)}px`;

        if (this.popup.root.style.top !== top) {
            this.popup.root.style.top = top;
        }

        if (this.popup.root.style.left !== left) {
            this.popup.root.style.left = left;
        }

        this.popup.root.dataset.placement = position.placement;
        this.popup.root.style.visibility = 'visible';
        this.popup.root.style.pointerEvents = 'auto';
    }

    buildPopupContent({ closeable = true } = {}) {
        return `
      <div class="oa-header">
        <div class="oa-title">
          <a class="oa-logo"
            href="https://github.com/tn3w/OpenAge"
            target="_blank" rel="noopener">
            Open<strong>Age</strong>
          </a>
          <span class="oa-badge">on-device</span>
        </div>
                ${
                    closeable
                        ? `<button class="oa-close-btn"
                    aria-label="Close">
                    ${CLOSE_SVG}
                </button>`
                        : ''
                }
      </div>
      <div class="oa-body">
        ${heroTemplate('Initializing…')}
      </div>
      <div class="oa-actions oa-hidden">
        <button class="oa-btn oa-start-btn">
          Begin Verification
        </button>
      </div>
    `;
    }

    bindPopupEvents(root) {
        const closeBtn = root.querySelector('.oa-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closePopup();
                this.params.closeCallback?.();
            });
        }

        const startBtn = root.querySelector('.oa-start-btn');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                if (this.onStartClick) this.onStartClick();
            });
        }

        this.popupElements = {
            body: root.querySelector('.oa-body'),
            actions: root.querySelector('.oa-actions'),
            startBtn,
            heroStatus: root.querySelector('.oa-hero-status'),
        };
    }

    getVideo() {
        if (!this.popup) return null;
        return this.popup.root.querySelector('video');
    }

    showHero(statusText) {
        if (!this.popupElements?.body) return;
        this.popupElements.body.innerHTML = heroTemplate(statusText);
        this.popupElements.heroStatus = this.popupElements.body.querySelector('.oa-hero-status');
        this.hideActions();
    }

    showReady() {
        this.setHeroStatus('Ready to verify your age.');
        this.showActions('Begin Verification');
    }

    showCamera() {
        if (!this.popupElements?.body) return;
        this.popupElements.body.innerHTML = challengeTemplate();

        this.popupElements.video = this.popupElements.body.querySelector('video');
        this.popupElements.faceGuide = this.popupElements.body.querySelector('.oa-face-guide');
        this.popupElements.challengeHud =
            this.popupElements.body.querySelector('.oa-challenge-hud');
        this.popupElements.challengeText =
            this.popupElements.body.querySelector('.oa-challenge-text');
        this.popupElements.challengeFill =
            this.popupElements.body.querySelector('.oa-challenge-fill');
        this.popupElements.videoStatus =
            this.popupElements.body.querySelector('.oa-video-status p');

        this.hideActions();
        return this.popupElements.video;
    }

    showLiveness() {
        if (this.popupElements?.faceGuide) {
            this.popupElements.faceGuide.classList.remove('oa-hidden');
        }
        if (this.popupElements?.challengeHud) {
            this.popupElements.challengeHud.classList.remove('oa-hidden');
        }
    }

    setHeroStatus(text) {
        if (this.popupElements?.heroStatus) {
            this.popupElements.heroStatus.textContent = text;
        }
    }

    setVideoStatus(text) {
        if (this.popupElements?.videoStatus) {
            this.popupElements.videoStatus.textContent = text;
        }
    }

    setInstruction(text) {
        if (this.popupElements?.challengeText) {
            this.popupElements.challengeText.textContent = text;
        }
    }

    setStatus(text) {
        this.setVideoStatus(text);
    }

    setProgress(fraction) {
        if (this.popupElements?.challengeFill) {
            this.popupElements.challengeFill.style.width = `${Math.round(fraction * 100)}%`;
        }
    }

    setTask(taskId) {
        if (this.popupElements?.faceGuide) {
            this.popupElements.faceGuide.setAttribute('data-task', taskId || '');
        }
    }

    showActions(label) {
        if (!this.popupElements?.actions) return;
        this.popupElements.actions.classList.remove('oa-hidden');
        if (this.popupElements.startBtn) {
            this.popupElements.startBtn.textContent = label;
        }
    }

    hideActions() {
        if (this.popupElements?.actions) {
            this.popupElements.actions.classList.add('oa-hidden');
        }
    }

    showResult(outcome, message) {
        if (this.isInlineLayout()) {
            if (!this.popupElements?.body) return;

            this.popupElements.body.innerHTML = resultTemplate(outcome, message);
            this.hideActions();

            if (outcome === 'pass') {
                this.setState('verified');
                return;
            }

            this.setState(outcome === 'fail' ? 'failed' : 'retry');
            this.showActions('Try Again');
            return;
        }

        if (outcome === 'pass') {
            this.closePopup();
            this.setState('verified');
            return;
        }

        if (outcome === 'fail') {
            if (this.params.size === 'invisible') {
                if (this.popupElements?.body) {
                    this.popupElements.body.innerHTML = resultTemplate(outcome, message);
                }
                this.hideActions();
                this.showActions('Try Again');
            } else {
                this.closePopup();
                this.setState('retry');
            }
            return;
        }

        if (outcome === 'retry') {
            if (this.params.size !== 'invisible') {
                this.closePopup();
                this.setState('retry');
                return;
            }

            if (this.popupElements?.body) {
                this.popupElements.body.innerHTML = resultTemplate(outcome, message);
            }
            this.hideActions();
            this.showActions('Try Again');
        }
    }

    showError(message) {
        if (!this.popupElements?.body) return;

        this.popupElements.body.innerHTML = errorStepTemplate(message);
        this.popupElements.errorCountdown = this.popupElements.body.querySelector(
            '.oa-error-step-countdown'
        );
        this.hideActions();
    }

    setErrorCountdown(seconds) {
        if (!this.popupElements?.errorCountdown) return;

        const unit = seconds === 1 ? 'second' : 'seconds';
        this.popupElements.errorCountdown.textContent = `Closing in ${seconds} ${unit}…`;
    }

    clearError() {
        if (this.elements.errorSlot) {
            this.elements.errorSlot.innerHTML = '';
        }
    }

    closePopup() {
        if (!this.popup) return;

        if (this.popup.inline) {
            this.popup.cleanup?.();
            if (this.popupFrame) {
                cancelAnimationFrame(this.popupFrame);
                this.popupFrame = 0;
            }
            this.resetInlineShell();

            if (this.state === 'loading') {
                this.setState('idle');
            }

            return;
        }

        this.popup.cleanup?.();
        this.popup.themeCleanup?.();
        this.popup.host.remove();
        this.popup = null;
        this.popupElements = null;

        if (this.state === 'loading') {
            this.setState('idle');
        }
    }

    setState(newState) {
        this.state = newState;
        const cb = this.elements.checkbox;
        const box = this.elements.checkBox;
        if (!cb || !box) return;

        cb.classList.remove('oa-loading', 'oa-verified', 'oa-failed', 'oa-retry', 'oa-expired');
        cb.setAttribute('aria-checked', 'false');
        box.innerHTML = '';

        switch (newState) {
            case 'loading':
                cb.classList.add('oa-loading');
                box.innerHTML = `<span class="oa-spinner">` + `${SPINNER_SVG}</span>`;
                break;
            case 'verified':
                cb.classList.add('oa-verified');
                cb.setAttribute('aria-checked', 'true');
                box.innerHTML = CHECK_SVG;
                break;
            case 'failed':
                cb.classList.add('oa-failed');
                box.innerHTML = '✕';
                break;
            case 'retry':
                cb.classList.add('oa-retry');
                box.innerHTML = RETRY_SVG;
                break;
            case 'expired':
                cb.classList.add('oa-expired');
                cb.setAttribute('aria-checked', 'false');
                break;
            default:
                break;
        }
    }

    getToken() {
        return this.token;
    }

    reset() {
        this.token = null;
        this.closePopup();
        this.setState('idle');
    }

    destroy() {
        this.closePopup();
        this.themeCleanup?.();
        this.host?.remove();
    }
}

export function createModalWidget(params) {
    const widget = new Widget(document.createElement('div'), { ...params, size: 'invisible' });
    return widget;
}

function resolveContainer(container) {
    if (typeof container === 'string') {
        return document.querySelector(container);
    }
    return container;
}

function findPopupPosition(anchorRect, popupRect) {
    const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
    };

    const popupWidth = Math.max(popupRect.width || 0, POPUP_MIN_WIDTH);
    const popupHeight = Math.max(popupRect.height || 0, POPUP_MIN_HEIGHT);
    const availableWidth = viewport.width - POPUP_MARGIN * 2;
    const availableHeight = viewport.height - POPUP_MARGIN * 2;

    if (popupWidth > availableWidth || popupHeight > availableHeight) {
        return { mode: 'modal' };
    }

    const left = clampLeft(
        anchorRect.left + anchorRect.width / 2 - popupWidth / 2,
        viewport.width,
        popupWidth
    );

    const topBelow = anchorRect.bottom + POPUP_MARGIN;
    const topAbove = anchorRect.top - popupHeight - POPUP_MARGIN;
    const fitsBelow = topBelow + popupHeight <= viewport.height - POPUP_MARGIN;
    const fitsAbove = topAbove >= POPUP_MARGIN;

    if (fitsBelow || !fitsAbove) {
        return {
            mode: 'popup',
            placement: 'below',
            top: clampTop(topBelow, viewport.height, popupHeight),
            left,
        };
    }

    return {
        mode: 'popup',
        placement: 'above',
        top: clampTop(topAbove, viewport.height, popupHeight),
        left,
    };
}

function clampLeft(left, viewportWidth, popupWidth) {
    return Math.min(Math.max(POPUP_MARGIN, left), viewportWidth - popupWidth - POPUP_MARGIN);
}

function clampTop(top, viewportHeight, popupHeight) {
    return Math.min(Math.max(POPUP_MARGIN, top), viewportHeight - popupHeight - POPUP_MARGIN);
}
