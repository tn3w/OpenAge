import { Widget, createModalWidget } from './widget.js';
import { runChallenge } from './challenge.js';
import { verifyToken, decodeToken } from './transport.js';
import { VERSION } from './constants.js';

export class EventEmitter {
    constructor() {
        this.listeners = new Map();
    }

    on(event, handler) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(handler);
        return this;
    }

    off(event, handler) {
        const handlers = this.listeners.get(event);
        if (handlers) handlers.delete(handler);
        return this;
    }

    once(event, handler) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            handler(...args);
        };
        wrapper._original = handler;
        return this.on(event, wrapper);
    }

    emit(event, ...args) {
        const handlers = this.listeners.get(event);
        if (!handlers) return;
        for (const handler of [...handlers]) {
            handler(...args);
        }
    }

    removeAllListeners(event) {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
        return this;
    }
}

const emitter = new EventEmitter();
const widgets = new Map();

function normalizeLayout(layout) {
    if (layout === 'inline' || layout === 'embed' || layout === 'embedded') {
        return 'inline';
    }

    return 'widget';
}

function normalizeParams(params) {
    const globalConfig = typeof window !== 'undefined' ? window.openage || {} : {};
    const layout = normalizeLayout(
        params.layout ?? params.display ?? globalConfig.layout ?? globalConfig.display
    );

    return {
        mode: 'serverless',
        theme: 'auto',
        size: 'normal',
        minAge: 18,
        ...globalConfig,
        ...params,
        layout,
    };
}

function startWidget(widget) {
    widget.onChallenge = () => {
        emitter.emit('opened', widget.id);
        runChallenge(widget, emitter);
    };

    if (widget.params.layout === 'inline') {
        widget.startChallenge();
    }
}

function render(container, params = {}) {
    const normalized = normalizeParams(params);
    const widget = new Widget(container, normalized);
    widgets.set(widget.id, widget);
    startWidget(widget);
    return widget.id;
}

function open(params = {}) {
    const normalized = normalizeParams(params);
    const widget = createModalWidget(normalized);
    widget.anchorElement = normalized.anchorElement || null;
    widgets.set(widget.id, widget);

    widget.onChallenge = () => {
        emitter.emit('opened', widget.id);
        runChallenge(widget, emitter);
    };

    widget.startChallenge();
    return widget.id;
}

function bind(element, params = {}) {
    const normalized = normalizeParams(params);
    const target = typeof element === 'string' ? document.querySelector(element) : element;

    if (!target) {
        throw new Error('OpenAge: element not found');
    }

    let isReplayingClick = false;
    let activeWidgetId = null;

    const replayTargetClick = () => {
        isReplayingClick = true;
        try {
            target.click();
        } finally {
            isReplayingClick = false;
        }
    };

    const clearActiveWidget = () => {
        activeWidgetId = null;
    };

    const handler = (event) => {
        if (isReplayingClick || activeWidgetId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();

        const widgetId = open({
            ...normalized,
            anchorElement: target,
            callback: (token) => {
                normalized.callback?.(token);
                clearActiveWidget();
                replayTargetClick();
            },
            errorCallback: (error) => {
                clearActiveWidget();
                normalized.errorCallback?.(error);
            },
            closeCallback: () => {
                clearActiveWidget();
                normalized.closeCallback?.();
            },
        });

        activeWidgetId = widgetId;

        return widgetId;
    };

    target.addEventListener('click', handler, true);

    return () => {
        target.removeEventListener('click', handler, true);
    };
}

function reset(widgetId) {
    widgets.get(widgetId)?.reset();
}

function remove(widgetId) {
    const widget = widgets.get(widgetId);
    if (!widget) return;
    widget.destroy();
    widgets.delete(widgetId);
}

function getToken(widgetId) {
    return widgets.get(widgetId)?.getToken() || null;
}

function execute(widgetId) {
    const widget = widgets.get(widgetId);
    if (!widget) return;
    widget.startChallenge();
}

function challenge(params = {}) {
    return new Promise((resolve, reject) => {
        open({
            ...params,
            callback: (token) => resolve(token),
            errorCallback: (error) => reject(typeof error === 'string' ? new Error(error) : error),
            closeCallback: () => reject(new Error('User dismissed')),
        });
    });
}

function on(event, handler) {
    emitter.on(event, handler);
}

function off(event, handler) {
    emitter.off(event, handler);
}

function once(event, handler) {
    emitter.once(event, handler);
}

function autoRender() {
    if (typeof document === 'undefined') return;

    const globalConfig = typeof window !== 'undefined' ? window.openage || {} : {};

    if (globalConfig.render === 'explicit') return;

    const elements = document.querySelectorAll('.openage');

    for (const element of elements) {
        const params = {
            sitekey: element.dataset.sitekey,
            theme: element.dataset.theme,
            size: element.dataset.size,
            action: element.dataset.action,
            mode: element.dataset.mode,
            layout: element.dataset.layout || element.dataset.display,
            server: element.dataset.server,
        };

        if (element.dataset.callback) {
            params.callback = (token) => {
                const fn = window[element.dataset.callback];
                if (typeof fn === 'function') fn(token);
            };
        }

        if (element.dataset.errorCallback) {
            params.errorCallback = (error) => {
                const fn = window[element.dataset.errorCallback];
                if (typeof fn === 'function') fn(error);
            };
        }

        if (element.dataset.expiredCallback) {
            params.expiredCallback = () => {
                const fn = window[element.dataset.expiredCallback];
                if (typeof fn === 'function') fn();
            };
        }

        if (element.dataset.bind) {
            const target = document.getElementById(element.dataset.bind);
            if (target) {
                bind(target, params);
                continue;
            }
        }

        render(element, params);
    }

    const onloadName = document.currentScript?.dataset?.onload;
    if (onloadName && typeof window[onloadName] === 'function') {
        window[onloadName]();
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoRender);
    } else {
        autoRender();
    }
}

const OpenAge = {
    render,
    open,
    bind,
    reset,
    remove,
    getToken,
    execute,
    challenge,
    on,
    off,
    once,
    verify: verifyToken,
    decode: decodeToken,
    version: VERSION,
};

export default OpenAge;
export {
    render,
    open,
    bind,
    reset,
    remove,
    getToken,
    execute,
    challenge,
    on,
    off,
    once,
    verifyToken as verify,
    decodeToken as decode,
    VERSION as version,
};
