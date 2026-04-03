#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const QJS_DIR = path.join(ROOT, 'vendor', 'quickjs');
const QJSC = path.join(QJS_DIR, 'qjsc');

let inputFile = null;
let outputFile = null;
let manifestFile = null;

for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--out' && process.argv[i + 1])
        outputFile = path.resolve(process.argv[++i]);
    else if (process.argv[i] === '--manifest' && process.argv[i + 1])
        manifestFile = path.resolve(process.argv[++i]);
    else if (!inputFile) inputFile = path.resolve(process.argv[i]);
}

if (!inputFile) {
    console.error(
        'Usage: compile.js <input.js>' + ' --out <output.vmbc>' + ' --manifest <manifest.json>'
    );
    process.exit(1);
}

if (!outputFile) outputFile = inputFile.replace(/\.js$/, '.vmbc');

if (!manifestFile) {
    console.error('[compile] --manifest is required');
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
const decryptKey = Buffer.from(manifest.keys.decrypt, 'hex');

function ensureQjsc() {
    if (fs.existsSync(QJSC)) return;
    console.log('[compile] Building qjsc...');
    execSync('make qjsc', {
        cwd: QJS_DIR,
        stdio: 'inherit',
    });
}

function compileToBytecode(jsFile) {
    const tmpBc = path.join(path.dirname(outputFile), `_tmp_${Date.now()}.bc`);
    const tmpC = tmpBc + '.c';

    execSync(`"${QJSC}" -e -o "${tmpC}" "${jsFile}"`, { cwd: ROOT, stdio: 'inherit' });

    const cSource = fs.readFileSync(tmpC, 'utf-8');
    const parseByteList = (text) =>
        text
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => Number(s))
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 255);

    const match = cSource.match(/qjsc_\w+\[\d+\]\s*=\s*\{([^}]+)\}/);
    if (!match) {
        const bufMatch = cSource.match(/uint8_t\s+\w+\[\]\s*=\s*\{\s*([\s\S]*?)\s*\};/);
        if (!bufMatch) throw new Error('Cannot parse qjsc output');
        const bytes = parseByteList(bufMatch[1]);
        fs.unlinkSync(tmpC);
        return Buffer.from(bytes);
    }

    const bytes = parseByteList(match[1]);

    fs.unlinkSync(tmpC);
    return Buffer.from(bytes);
}

function encryptBytecode(bytecode, key) {
    const MAGIC_BC = 0x564d4243;
    const nonce = crypto.randomBytes(12);

    const counter = Buffer.alloc(4);
    counter.writeUInt32LE(1);
    const iv = Buffer.concat([counter, nonce]);

    const cipher = crypto.createCipheriv('chacha20', key, iv);
    const ciphertext = Buffer.concat([cipher.update(bytecode), cipher.final()]);

    const header = Buffer.alloc(8);
    header.writeUInt32LE(MAGIC_BC, 0);
    header.writeUInt32LE(bytecode.length, 4);

    return Buffer.concat([header, nonce, ciphertext]);
}

ensureQjsc();

console.log(`[compile] Compiling ${inputFile}...`);
const bytecode = compileToBytecode(inputFile);
console.log(`[compile] Bytecode: ${bytecode.length} bytes`);

const encrypted = encryptBytecode(bytecode, decryptKey);
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, encrypted);
console.log(`[compile] Written ${outputFile}` + ` (${encrypted.length} bytes)`);
