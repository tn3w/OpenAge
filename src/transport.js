import { TOKEN_EXPIRY_S } from './constants.js';

function base64UrlEncode(data) {
    const text = typeof data === 'string' ? data : String.fromCharCode(...new Uint8Array(data));
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
    const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
    const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function getSigningKey() {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
        'verify',
    ]);
}

let cachedKey = null;

async function ensureKey() {
    if (!cachedKey) cachedKey = await getSigningKey();
    return cachedKey;
}

export async function createToken(payload) {
    const key = await ensureKey();

    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

    const body = base64UrlEncode(
        JSON.stringify({
            ...payload,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_S,
        })
    );

    const data = new TextEncoder().encode(`${header}.${body}`);
    const signature = await crypto.subtle.sign('HMAC', key, data);

    return `${header}.${body}.${base64UrlEncode(signature)}`;
}

export async function verifyToken(token) {
    const key = await ensureKey();
    const [header, body, sig] = token.split('.');

    if (!header || !body || !sig) return null;

    let signature;
    let data;
    try {
        data = new TextEncoder().encode(`${header}.${body}`);
        signature = base64UrlDecode(sig);
    } catch {
        return null;
    }

    const valid = await crypto.subtle.verify('HMAC', key, signature, data);

    if (!valid) return null;

    const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));

    if (decoded.exp && decoded.exp < Date.now() / 1000) {
        return null;
    }

    return decoded;
}

export function decodeToken(token) {
    const [, body] = token.split('.');
    if (!body) return null;
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
}

export function createTransport(mode, options = {}) {
    if (mode === 'serverless') {
        return createServerlessTransport(options);
    }

    const baseUrl = mode === 'custom' ? options.server : 'https://api.openage.dev';

    return createServerTransport(baseUrl, options);
}

function createServerlessTransport(options) {
    return {
        async verify(payload) {
            const { estimatedAge, livenessOk } = payload;

            if (!livenessOk) {
                return { success: false, token: null };
            }

            if (options.minAge != null && estimatedAge < options.minAge) {
                return { success: false, token: null };
            }

            const token = await createToken({
                estimatedAge,
                livenessOk: true,
                mode: 'serverless',
            });

            return { success: true, token };
        },
        close() {},
    };
}

function createServerTransport(baseUrl, options) {
    let session = null;
    let channel = null;

    return {
        async createSession() {
            const transports = [];
            if (typeof WebSocket !== 'undefined') {
                transports.push('websocket');
            }
            transports.push('poll');

            const response = await fetch(`${baseUrl}/api/session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sitekey: options.sitekey,
                    action: options.action,
                    supportedTransports: transports,
                }),
            });

            if (!response.ok) {
                throw new Error('Request failed');
            }

            session = await response.json();
            return session;
        },

        openChannel() {
            if (!session) {
                throw new Error('No session');
            }

            if (session.transport === 'websocket') {
                channel = createWsChannel(baseUrl, session.sessionId);
            } else {
                channel = createPollChannel(baseUrl, session.sessionId);
            }
        },

        async receive() {
            if (!channel) return null;
            return channel.receive();
        },

        async send(data) {
            if (!channel) return;
            return channel.send(data);
        },

        async sendAndReceive(data) {
            if (!channel) return null;
            return channel.sendAndReceive(data);
        },

        async verify(payload) {
            if (channel) {
                return this.verifyViaChannel(payload);
            }

            const response = await fetch(`${baseUrl}/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    response: payload.token,
                    sitekey: options.sitekey,
                    action: options.action,
                }),
            });

            if (!response.ok) {
                return {
                    success: false,
                    token: null,
                };
            }

            return response.json();
        },

        async verifyViaChannel(payload) {
            await channel.send(payload);
            return channel.receive();
        },

        getSession() {
            return session;
        },

        close() {
            channel?.close();
            channel = null;
            session = null;
        },
    };
}

function createWsChannel(baseUrl, sessionId) {
    const wsUrl = baseUrl.replace(/^http/, 'ws').replace(/\/$/, '');
    const url = `${wsUrl}/api/ws/${sessionId}`;
    const ws = new WebSocket(url);
    let pending = [];
    let ready = false;
    let closed = false;

    const waitReady = new Promise((resolve, reject) => {
        ws.onopen = () => {
            ready = true;
            resolve();
        };
        ws.onerror = () => {
            reject(new Error('Connection failed'));
        };
    });

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        const resolver = pending.shift();
        if (resolver) resolver(message);
    };

    ws.onclose = () => {
        closed = true;
        for (const resolver of pending) resolver(null);
        pending = [];
    };

    return {
        receive() {
            if (closed) return Promise.resolve(null);
            return new Promise((resolve) => {
                pending.push(resolve);
            });
        },
        async send(data) {
            await waitReady;
            ws.send(JSON.stringify(data));
        },
        async sendAndReceive(data) {
            await waitReady;
            ws.send(JSON.stringify(data));
            return this.receive();
        },
        close() {
            closed = true;
            ws.close();
        },
    };
}

function createPollChannel(baseUrl, sessionId) {
    return {
        async receive() {
            const response = await fetch(`${baseUrl}/api/poll/${sessionId}`);
            if (!response.ok) {
                throw new Error('Request failed');
            }
            return response.json();
        },
        async send(data) {
            const response = await fetch(`${baseUrl}/api/verify/${sessionId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                throw new Error('Request failed');
            }
        },
        async sendAndReceive(data) {
            const response = await fetch(`${baseUrl}/api/verify/${sessionId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                throw new Error('Request failed');
            }
            return response.json();
        },
        close() {},
    };
}
