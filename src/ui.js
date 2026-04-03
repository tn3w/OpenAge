export const FACE_SVG = `<svg viewBox="0 0 100 120"
  fill="none" class="oa-face-svg">
  <ellipse cx="50" cy="55" rx="35" ry="45"
    stroke="currentColor" stroke-width="1.8"/>
  <ellipse cx="36" cy="45" rx="5" ry="3.5"
    fill="currentColor" class="oa-eye"/>
  <ellipse cx="64" cy="45" rx="5" ry="3.5"
    fill="currentColor" class="oa-eye"/>
  <line x1="50" y1="52" x2="48" y2="62"
    stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round"/>
  <path d="M40 72 Q50 79 60 72"
    stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" fill="none"/>
</svg>`;

export const FACE_ICON_SVG = `<svg viewBox="0 0 100 120"
  fill="none" class="oa-face-icon-svg">
  <ellipse cx="50" cy="55" rx="35" ry="45"
    stroke="currentColor" stroke-width="2"/>
  <ellipse cx="36" cy="45" rx="5" ry="3.5"
    fill="currentColor" class="oa-eye"/>
  <ellipse cx="64" cy="45" rx="5" ry="3.5"
    fill="currentColor" class="oa-eye"/>
  <line x1="50" y1="52" x2="48" y2="62"
    stroke="currentColor" stroke-width="1.65"
    stroke-linecap="round"/>
  <path d="M40 72 Q50 79 60 72"
    stroke="currentColor" stroke-width="1.65"
    stroke-linecap="round" fill="none"/>
</svg>`;

export const FACE_GUIDE_SVG = `<svg viewBox="0 0 100 120"
  fill="none" class="oa-face-svg">
  <ellipse cx="50" cy="55" rx="35" ry="45"
    stroke="currentColor" stroke-width="1.8"
    stroke-dasharray="6 4"/>
  <ellipse cx="36" cy="45" rx="5" ry="3.5"
    fill="currentColor" class="oa-eye"/>
  <ellipse cx="64" cy="45" rx="5" ry="3.5"
    fill="currentColor" class="oa-eye"/>
  <line x1="50" y1="52" x2="48" y2="62"
    stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round"/>
  <path d="M40 72 Q50 79 60 72"
    stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" fill="none"/>
</svg>`;

export const CHECK_SVG = `<svg viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2.5"
  stroke-linecap="round" stroke-linejoin="round">
  <polyline points="20 6 9 17 4 12"/>
</svg>`;

export const CLOSE_SVG = `<svg viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

export const RETRY_SVG = `<svg viewBox="0 0 16 16"
  xmlns="http://www.w3.org/2000/svg"
  fill="currentColor">
  <path d="m14.955 7.986.116.01a1 1 0 0 1 .85 1.13 8 8 0 0 1-13.374 4.728l-.84.84c-.63.63-1.707.184-1.707-.707V10h3.987c.89 0 1.337 1.077.707 1.707l-.731.731a6 6 0 0 0 8.347-.264 6 6 0 0 0 1.63-3.33 1 1 0 0 1 1.131-.848zM11.514.813a8 8 0 0 1 1.942 1.336l.837-.837c.63-.63 1.707-.184 1.707.707V6h-3.981c-.89 0-1.337-1.077-.707-1.707l.728-.729a6 6 0 0 0-9.98 3.591 1 1 0 1 1-1.98-.281A8 8 0 0 1 11.514.813"/>
</svg>`;

export const SPINNER_SVG = `<svg viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2.5">
  <circle cx="12" cy="12" r="10" opacity="0.2"/>
  <path d="M12 2 A10 10 0 0 1 22 12"
    stroke-linecap="round">
    <animateTransform attributeName="transform"
      type="rotate" from="0 12 12" to="360 12 12"
      dur="0.8s" repeatCount="indefinite"/>
  </path>
</svg>`;

export const SHIELD_SVG = `<svg viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M12 2l8 4v6c0 5.5-3.8 10-8 12
    C7.8 22 4 17.5 4 12V6l8-4z"/>
  <path d="M9 12l2 2 4-4" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export function resolveTheme(theme) {
    if (theme === 'light' || theme === 'dark') return theme;
    return resolveAutoTheme();
}

export function watchTheme(host, theme) {
    if (theme === 'light' || theme === 'dark') return;
    if (typeof window === 'undefined') return;

    const update = () => {
        host.setAttribute('data-theme', resolveAutoTheme());
    };

    const cleanups = [];

    for (const query of ['(prefers-color-scheme: dark)', '(prefers-color-scheme: light)']) {
        const cleanup = watchMediaQuery(query, update);
        if (cleanup) cleanups.push(cleanup);
    }

    if (typeof MutationObserver === 'function') {
        const observer = new MutationObserver(update);
        const options = {
            attributes: true,
            attributeFilter: ['class', 'data-theme', 'style'],
        };

        if (document.documentElement) {
            observer.observe(document.documentElement, options);
        }

        if (document.body) {
            observer.observe(document.body, options);
        }

        cleanups.push(() => observer.disconnect());
    }

    return () => {
        for (const cleanup of cleanups) {
            cleanup();
        }
    };
}

function resolveAutoTheme() {
    if (typeof window === 'undefined') return 'dark';

    const documentTheme = resolveDocumentTheme();
    if (documentTheme) return documentTheme;

    const systemTheme = resolveSystemTheme();
    if (systemTheme) return systemTheme;

    return 'dark';
}

function resolveSystemTheme() {
    if (typeof window.matchMedia !== 'function') {
        return null;
    }

    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }

    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
    }

    return null;
}

function resolveDocumentTheme() {
    if (typeof document === 'undefined') return null;

    for (const element of [document.documentElement, document.body]) {
        const theme = readThemeHint(element);
        if (theme) return theme;
    }

    return null;
}

function readThemeHint(element) {
    if (!element || typeof window.getComputedStyle !== 'function') {
        return null;
    }

    const explicit = readExplicitTheme(element);
    if (explicit) return explicit;

    const styles = window.getComputedStyle(element);
    const scheme = parseColorScheme(styles.colorScheme);
    if (scheme) return scheme;

    return parseBackgroundTheme(styles.backgroundColor);
}

function readExplicitTheme(element) {
    const attrTheme = element.getAttribute('data-theme');
    if (attrTheme === 'light' || attrTheme === 'dark') {
        return attrTheme;
    }

    const className = element.className;
    if (typeof className !== 'string') return null;

    if (/\bdark\b|theme-dark|dark-theme/i.test(className)) {
        return 'dark';
    }

    if (/\blight\b|theme-light|light-theme/i.test(className)) {
        return 'light';
    }

    return null;
}

function parseColorScheme(value) {
    if (!value || value === 'normal') return null;

    const normalized = value.toLowerCase();
    const hasDark = normalized.includes('dark');
    const hasLight = normalized.includes('light');

    if (hasDark && !hasLight) return 'dark';
    if (hasLight && !hasDark) return 'light';

    return null;
}

function parseBackgroundTheme(value) {
    if (!value || value === 'transparent') return null;

    const match = value.match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;

    const parts = match[1]
        .split(',')
        .slice(0, 3)
        .map((part) => Number.parseFloat(part.trim()));

    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        return null;
    }

    const [red, green, blue] = parts;
    const brightness = (red * 299 + green * 587 + blue * 114) / 1000;

    if (brightness <= 140) return 'dark';
    if (brightness >= 180) return 'light';

    return null;
}

function watchMediaQuery(query, listener) {
    if (typeof window.matchMedia !== 'function') {
        return null;
    }

    const mediaQuery = window.matchMedia(query);

    if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', listener);
        return () => {
            mediaQuery.removeEventListener('change', listener);
        };
    }

    if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(listener);
        return () => {
            mediaQuery.removeListener(listener);
        };
    }

    return null;
}

export const STYLES = `
:host {
  --oa-bg: #0b0d11;
  --oa-surface: #14161d;
  --oa-border: #1f2230;
  --oa-text: #e8e8ed;
  --oa-text-muted: #7a7d8c;
  --oa-accent: #4ae68a;
  --oa-accent-dim: rgba(74, 230, 138, 0.12);
  --oa-danger: #ef4444;
  --oa-warn: #f59e0b;
  --oa-radius: 16px;
  --oa-font: 'DM Sans', system-ui, -apple-system,
    sans-serif;
  --oa-mono: 'Space Mono', monospace;

  display: block;
  font-family: var(--oa-font);
  color: var(--oa-text);
  line-height: 1.4;
}

:host([data-theme="light"]) {
  --oa-bg: #f8f9fb;
  --oa-surface: #ffffff;
  --oa-border: #e2e4ea;
  --oa-text: #1a1c24;
  --oa-text-muted: #6b6e7b;
  --oa-accent: #22c55e;
  --oa-accent-dim: rgba(34, 197, 94, 0.1);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Checkbox ────────────────────────────────── */

.oa-checkbox {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--oa-surface);
  border: 2px solid var(--oa-border);
  border-radius: var(--oa-radius);
  cursor: pointer;
  user-select: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.oa-checkbox:hover {
  border-color: var(--oa-text-muted);
}

.oa-checkbox.oa-verified {
  border-color: var(--oa-accent);
  cursor: default;
}

.oa-checkbox.oa-failed {
  border-color: var(--oa-danger);
}

.oa-checkbox.oa-retry {
  border-color: var(--oa-danger);
}

.oa-checkbox.oa-expired {
  border-color: var(--oa-warn);
}

.oa-checkbox.oa-loading {
  align-items: center;
}

.oa-check-box {
  width: 24px;
  height: 24px;
  border: 2px solid var(--oa-border);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
}

.oa-loading .oa-check-box {
  border-color: transparent;
  background: transparent;
}

.oa-loading .oa-check-box .oa-spinner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translateY(2px);
}

.oa-verified .oa-check-box {
  background: var(--oa-accent);
  border-color: var(--oa-accent);
  color: var(--oa-bg);
}

.oa-failed .oa-check-box {
  background: var(--oa-danger);
  border-color: var(--oa-danger);
  color: white;
}

.oa-retry .oa-check-box {
  background: var(--oa-danger);
  border-color: var(--oa-danger);
  color: white;
}

.oa-check-box svg {
  width: 14px;
  height: 14px;
}

.oa-check-box .oa-spinner svg {
  width: 18px;
  height: 18px;
}

.oa-label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.oa-label-text {
  font-size: 13px;
  font-weight: 600;
}

.oa-right-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  margin-left: auto;
}

.oa-face-icon-wrap {
  width: 18px;
  height: 22px;
  color: var(--oa-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.oa-face-icon-wrap .oa-face-icon-svg {
  width: 100%;
  height: 100%;
}

.oa-face-icon-wrap .oa-eye {
  transform-box: fill-box;
  transform-origin: center;
  animation: oa-idle-blink 5s ease-in-out infinite;
}

.oa-face-icon-wrap .oa-face-icon-svg {
  animation: oa-breathe 4s ease-in-out infinite;
}

.oa-branding-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.oa-branding-link {
  font-size: 10px;
  font-weight: 700;
  font-family: var(--oa-mono);
  color: var(--oa-text-muted);
  text-decoration: none;
  letter-spacing: -0.02em;
  cursor: pointer;
}

.oa-branding-link:hover {
  color: var(--oa-text);
}

.oa-links-row {
  display: flex;
  gap: 6px;
  justify-content: center;
}

.oa-links-row a {
  font-size: 9px;
  color: var(--oa-text-muted);
  text-decoration: none;
  opacity: 0.7;
  cursor: pointer;
}

.oa-links-row a:hover {
  opacity: 1;
  text-decoration: underline;
}

.oa-compact .oa-label-text {
  font-size: 11px;
}

.oa-compact .oa-face-icon-wrap {
  width: 16px;
  height: 20px;
}

/* ── Error banner (inline in checkbox) ───────── */

.oa-error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-top: 6px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 8px;
  font-size: 12px;
  color: var(--oa-danger);
  animation: oa-fade-in 0.3s ease;
}

.oa-error-banner button {
  margin-left: auto;
  background: none;
  border: 1px solid var(--oa-danger);
  border-radius: 6px;
  color: var(--oa-danger);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  cursor: pointer;
  font-family: var(--oa-font);
  flex-shrink: 0;
}

.oa-error-banner button:hover {
  background: rgba(239, 68, 68, 0.1);
}

/* ── Popup / Modal shell ─────────────────────── */

.oa-popup {
  position: fixed;
  z-index: 100000;
  background: var(--oa-bg);
  border: 1px solid var(--oa-border);
  border-radius: var(--oa-radius);
  box-shadow: 0 20px 60px rgba(0,0,0,0.4),
    0 0 0 1px rgba(0,0,0,0.08);
  width: 340px;
  max-height: 90vh;
  overflow: hidden;
  animation: oa-popup-in 0.25s ease;
  display: flex;
  flex-direction: column;
}

.oa-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0,0,0,0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: oa-fade-in 0.2s ease;
  backdrop-filter: blur(6px);
}

.oa-modal {
  background: var(--oa-bg);
  border: 1px solid var(--oa-border);
  border-radius: var(--oa-radius);
  width: 360px;
  max-width: 95vw;
  max-height: 95vh;
  overflow: hidden;
  animation: oa-slide-in 0.3s ease;
  display: flex;
  flex-direction: column;
}

/* ── Header ──────────────────────────────────── */

.oa-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--oa-border);
  flex-shrink: 0;
}

.oa-logo {
  font-family: var(--oa-mono);
  font-size: 0.85rem;
  letter-spacing: -0.03em;
  color: var(--oa-text-muted);
  text-decoration: none;
  cursor: pointer;
}

.oa-logo:hover {
  color: var(--oa-text);
}

.oa-logo strong {
  color: var(--oa-text);
  font-weight: 700;
}

.oa-badge {
  font-size: 0.55rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--oa-accent);
  background: var(--oa-accent-dim);
  padding: 2px 6px;
  border-radius: 100px;
  margin-left: 6px;
}

.oa-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.oa-close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--oa-text-muted);
  transition: background 0.15s, color 0.15s;
}

.oa-close-btn:hover {
  background: var(--oa-border);
  color: var(--oa-text);
}

.oa-close-btn svg {
  width: 16px;
  height: 16px;
}

/* ── Body (viewport) ─────────────────────────── */

.oa-body {
  flex: 1;
  position: relative;
  overflow: hidden;
}

/* ── Hero / start screen ─────────────────────── */

.oa-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem 1.2rem 1.2rem;
  background: var(--oa-surface);
  border: 1px solid var(--oa-border);
  border-radius: var(--oa-radius);
  margin: 10px;
  animation: oa-fade-in 0.4s ease;
}

.oa-hero-icon {
  width: 80px;
  height: 96px;
  color: var(--oa-text-muted);
}

.oa-hero-icon .oa-face-svg.oa-idle {
  animation: oa-breathe 4s ease-in-out infinite;
}

.oa-hero-icon .oa-eye {
  transform-box: fill-box;
  transform-origin: center;
  animation: oa-idle-blink 5s ease-in-out infinite;
}

.oa-hero-status {
  color: var(--oa-text-muted);
  font-size: 0.8rem;
  font-weight: 500;
  text-align: center;
  min-height: 1.4em;
}

.oa-hero-privacy {
  font-size: 0.68rem;
  color: var(--oa-text-muted);
  text-align: center;
  line-height: 1.5;
  max-width: 260px;
  opacity: 0.7;
}

.oa-hero-privacy svg {
  width: 10px;
  height: 10px;
  vertical-align: -2px;
  margin-right: 2px;
}

/* ── Start / Retry button ────────────────────── */

.oa-actions {
  display: flex;
  justify-content: center;
  padding: 0 14px 14px;
  flex-shrink: 0;
}

.oa-btn {
  font-family: var(--oa-font);
  padding: 0.55rem 1.5rem;
  border: none;
  border-radius: 10px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  background: var(--oa-accent);
  color: var(--oa-bg);
  transition: transform 0.12s, opacity 0.15s;
  width: 100%;
  max-width: 240px;
}

.oa-btn:hover { opacity: 0.88; }
.oa-btn:active { transform: scale(0.97); }

/* ── Video area ──────────────────────────────── */

.oa-video-area {
  position: relative;
  width: 100%;
  aspect-ratio: 3/4;
  max-height: 55vh;
  background: var(--oa-surface);
  overflow: hidden;
  border-radius: var(--oa-radius);
  margin: 10px;
  width: calc(100% - 20px);
  border: 1px solid var(--oa-border);
  animation: oa-fade-in 0.3s ease;
}

.oa-video-area video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);
}

/* ── Face guide overlay ──────────────────────── */

.oa-face-guide {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80%;
  max-width: 360px;
  aspect-ratio: 5/6;
  perspective: 400px;
  color: rgba(255, 255, 255, 0.45);
  pointer-events: none;
  z-index: 2;
  transition: opacity 0.4s ease;
}

.oa-face-guide .oa-face-svg {
  width: 100%;
  height: 100%;
  transform-origin: center center;
  filter: drop-shadow(
    0 0 16px rgba(15, 23, 42, 0.16)
  );
}

.oa-face-guide .oa-eye {
  transform-box: fill-box;
  transform-origin: center;
}

.oa-face-guide[data-task="turn-left"] .oa-face-svg {
  animation: oa-turn-left 2s ease-in-out infinite;
}
.oa-face-guide[data-task="turn-right"] .oa-face-svg {
  animation: oa-turn-right 2s ease-in-out infinite;
}
.oa-face-guide[data-task="nod"] .oa-face-svg {
  animation: oa-nod 2s ease-in-out infinite;
}
.oa-face-guide[data-task="blink-twice"] .oa-eye {
  animation: oa-blink 2.4s ease-in-out infinite;
}
.oa-face-guide[data-task="move-closer"] .oa-face-svg {
  animation: oa-closer 2.5s ease-in-out infinite;
}

/* ── Challenge HUD (bottom gradient overlay) ── */

.oa-challenge-hud {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 1rem 0.8rem 0.6rem;
  background: linear-gradient(
    to top,
    rgba(11, 13, 17, 0.92) 0%,
    rgba(11, 13, 17, 0) 100%
  );
  z-index: 3;
  pointer-events: none;
}

.oa-challenge-text {
  font-size: 0.85rem;
  font-weight: 600;
  text-align: center;
  color: var(--oa-text);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7);
  margin-bottom: 0.4rem;
}

.oa-challenge-bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.oa-challenge-fill {
  height: 100%;
  background: var(--oa-accent);
  border-radius: 2px;
  transition: width 0.25s ease;
}

/* ── Video status (top gradient overlay) ─────── */

.oa-video-status {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 0.8rem 0.8rem 1.2rem;
  background: linear-gradient(
    to bottom,
    rgba(11, 13, 17, 0.85) 0%,
    rgba(11, 13, 17, 0) 100%
  );
  z-index: 3;
  pointer-events: none;
}

.oa-video-status p {
  font-size: 0.75rem;
  font-weight: 500;
  text-align: center;
  color: var(--oa-text-muted);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}

/* ── Result area ─────────────────────────────── */

.oa-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 1.2rem;
  background: var(--oa-surface);
  border: 1px solid var(--oa-border);
  border-radius: var(--oa-radius);
  margin: 10px;
  animation: oa-fade-in 0.4s ease;
}

.oa-result-icon {
  font-size: 2.4rem;
  line-height: 1;
}

.oa-result-text {
  font-size: 0.85rem;
  font-weight: 500;
  text-align: center;
}

.oa-result-pass { color: var(--oa-accent); }
.oa-result-fail { color: var(--oa-danger); }
.oa-result-retry { color: var(--oa-warn); }

.oa-hidden { display: none !important; }

/* ── Animations ──────────────────────────────── */

@keyframes oa-popup-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes oa-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes oa-slide-in {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes oa-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}

@keyframes oa-idle-blink {
  0%, 42%, 48%, 100% { transform: scaleY(1); }
  44%, 46% { transform: scaleY(0.05); }
}

@keyframes oa-turn-left {
  0%, 100% { transform: rotateY(0); }
  35%, 65% { transform: rotateY(-30deg); }
}

@keyframes oa-turn-right {
  0%, 100% { transform: rotateY(0); }
  35%, 65% { transform: rotateY(30deg); }
}

@keyframes oa-nod {
  0%, 100% { transform: rotateX(0); }
  30%, 50% { transform: rotateX(25deg); }
}

@keyframes oa-blink {
  0%, 18%, 32%, 50%, 100% { transform: scaleY(1); }
  22%, 28% { transform: scaleY(0.05); }
  40%, 46% { transform: scaleY(0.05); }
}

@keyframes oa-closer {
  0%, 100% { transform: scale(1); }
  35%, 55% { transform: scale(1.3); }
}
`;

export function checkboxTemplate(labelText) {
    return `
    <div class="oa-widget-wrap">
      <div class="oa-checkbox" role="checkbox"
        aria-checked="false" tabindex="0">
        <div class="oa-check-box"></div>
        <div class="oa-label">
          <span class="oa-label-text">${labelText}</span>
        </div>
        <div class="oa-right-section">
          <div class="oa-branding-row">
            <div class="oa-face-icon-wrap">
              ${FACE_ICON_SVG}
            </div>
            <a class="oa-branding-link"
              href="https://github.com/tn3w/OpenAge"
              target="_blank" rel="noopener">OpenAge</a>
          </div>
          <div class="oa-links-row">
            <a href="https://github.com/tn3w/OpenAge"
              target="_blank"
              rel="noopener">Terms</a>
            <a href="https://github.com/tn3w/OpenAge"
              target="_blank"
              rel="noopener">Privacy</a>
          </div>
        </div>
      </div>
      <div class="oa-error-slot"></div>
    </div>
  `;
}

export function heroTemplate(statusText) {
    return `
    <div class="oa-hero">
      <div class="oa-hero-icon">
        ${FACE_SVG.replace('class="oa-face-svg"', 'class="oa-face-svg oa-idle"')}
      </div>
      <p class="oa-hero-status">${statusText}</p>
      <p class="oa-hero-privacy">
        ${SHIELD_SVG}
        Open-source &amp; privacy-focused.
        No photos or camera data leave your device.
      </p>
    </div>
  `;
}

export function challengeTemplate() {
    return `
    <div class="oa-video-area">
      <video autoplay playsinline muted></video>
      <div class="oa-face-guide">
        ${FACE_GUIDE_SVG}
      </div>
      <div class="oa-challenge-hud oa-hidden">
        <p class="oa-challenge-text"></p>
        <div class="oa-challenge-bar">
          <div class="oa-challenge-fill"
            style="width:0%"></div>
        </div>
      </div>
      <div class="oa-video-status">
        <p></p>
      </div>
    </div>
  `;
}

export function resultTemplate(outcome, message) {
    const icons = {
        fail: '✕',
        retry: '↻',
    };
    const classes = {
        fail: 'oa-result-fail',
        retry: 'oa-result-retry',
    };
    return `
    <div class="oa-result ${classes[outcome] || ''}">
      <div class="oa-result-icon">
        ${icons[outcome] || '?'}
      </div>
      <div class="oa-result-text">${message}</div>
    </div>
  `;
}

export function errorBannerTemplate(message) {
    return `
    <div class="oa-error-banner">
      <span>${message}</span>
      <button class="oa-retry-btn">Retry</button>
    </div>
  `;
}
