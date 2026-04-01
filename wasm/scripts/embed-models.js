#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BUILD_DIR = path.resolve(__dirname, '..', 'build');
const MODELS_DIR = path.join(BUILD_DIR, 'models');

const MODELS = {
    mediapipe: {
        url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
        filename: 'face_landmarker.task',
    },
};

function download(url, dest) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest)) {
            resolve();
            return;
        }
        fs.mkdirSync(path.dirname(dest), {
            recursive: true,
        });
        const file = fs.createWriteStream(dest);
        const get = (reqUrl) => {
            https
                .get(reqUrl, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        get(res.headers.location);
                        return;
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP ${res.statusCode}` + ` for ${reqUrl}`));
                        return;
                    }
                    res.pipe(file);
                    file.on('finish', () => {
                        file.close(resolve);
                    });
                })
                .on('error', reject);
        };
        console.log(`[models] Downloading ${path.basename(dest)}...`);
        get(url);
    });
}

async function downloadModels() {
    for (const [id, info] of Object.entries(MODELS)) {
        const dest = path.join(MODELS_DIR, info.filename);
        await download(info.url, dest);
        console.log(`[models] ${id}: ${dest}`);
    }
}

function chacha20Encrypt(data, key, nonce) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32LE(1);
    const iv = Buffer.concat([counter, nonce]);
    const cipher = crypto.createCipheriv('chacha20', key, iv);
    return Buffer.concat([cipher.update(data), cipher.final()]);
}

function encryptModels(decryptKey, outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const manifest = {};

    for (const [id, info] of Object.entries(MODELS)) {
        const srcPath = path.join(MODELS_DIR, info.filename);
        if (!fs.existsSync(srcPath)) {
            console.error(`[models] Missing: ${srcPath}`);
            continue;
        }

        const plaintext = fs.readFileSync(srcPath);
        const nonce = crypto.randomBytes(12);
        const ciphertext = chacha20Encrypt(plaintext, decryptKey, nonce);

        const header = Buffer.alloc(8);
        header.writeUInt32LE(plaintext.length, 0);
        header.writeUInt32LE(ciphertext.length, 4);

        const blob = Buffer.concat([header, nonce, ciphertext]);

        const encName = info.filename.replace(/\./g, '_') + '.enc';
        const destPath = path.join(outDir, encName);
        fs.writeFileSync(destPath, blob);

        manifest[id] = {
            file: encName,
            originalName: info.filename,
            size: plaintext.length,
        };

        console.log(
            `[models] Encrypted ${id}:` + ` ${plaintext.length}` + ` -> ${blob.length} bytes`
        );
    }

    return manifest;
}

module.exports = { downloadModels, encryptModels };
