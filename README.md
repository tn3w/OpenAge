<p align="center"><a href="https://tn3w.github.io/OpenAge/"><img src="https://github.com/tn3w/OpenAge/releases/download/img/openage.webp" alt="OpenAge - Privacy-first age verification for the web"></a></p>

<h3 align="center">Privacy-first age verification for the web</h3>
<p align="center">
OpenAge runs face tracking, liveness checks, and age estimation on-device.
Use it as a drop-in age gate with a checkbox-style widget, modal flow, or
button binding.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@tn3w/openage"><img src="https://img.shields.io/npm/v/%40tn3w%2Fopenage?label=npm" alt="Version"></a>
    <a href="https://www.npmjs.com/package/@tn3w/openage"><img src="https://img.shields.io/npm/dm/%40tn3w%2Fopenage" alt="Downloads"></a>
    <a href="https://www.npmjs.com/package/@tn3w/openage"><img src="https://img.shields.io/npm/l/%40tn3w%2Fopenage" alt="License"></a>
  <a href="https://tn3w.github.io/OpenAge/"><img src="https://img.shields.io/badge/demo-github%20pages-black" alt="Demo"></a>
</p>

## At a Glance

| Browser-side            | Server-backed              | UI                         |
| ----------------------- | -------------------------- | -------------------------- |
| On-device face analysis | Optional WASM verification | Embedded widget + popup    |
| No raw camera upload    | Signed sessions and tokens | Normal, compact, invisible |
| Serverless soft gates   | Hosted or custom backend   | Auto, light, dark          |

## Install

```bash
npm install @tn3w/openage
```

```html
<script src="https://cdn.jsdelivr.net/npm/@tn3w/openage/dist/openage.min.js"></script>
```

## Quick Start

### CDN

```html
<div class="openage" data-sitekey="ag_live_xxxx" data-callback="onVerified"></div>

<script src="https://cdn.jsdelivr.net/npm/@tn3w/openage/dist/openage.min.js"></script>
<script>
    function onVerified(token) {
        console.log('verified', token);
    }
</script>
```

### npm

```js
import OpenAge from '@tn3w/openage';

OpenAge.render('#gate', {
    mode: 'serverless',
    minAge: 18,
    callback: (token) => console.log(token),
    errorCallback: (error) => console.error(error),
});
```

### Bound Flow

```js
OpenAge.bind('#buy-btn', {
    sitekey: 'ag_live_xxxx',
    callback: (token) => submitForm(token),
});
```

## Modes

| Mode         | Backend        | Use case                 |
| ------------ | -------------- | ------------------------ |
| `serverless` | none           | client-only soft gates   |
| `sitekey`    | OpenAge hosted | production verification  |
| `custom`     | your server    | self-hosted verification |

`serverless` keeps everything local and returns a client-signed token.
`sitekey` and `custom` use a server session and a WASM VM for stronger checks.

## Core API

```js
OpenAge.render(container, params);
OpenAge.open(params);
OpenAge.bind(element, params);

OpenAge.reset(widgetId);
OpenAge.remove(widgetId);
OpenAge.getToken(widgetId);
OpenAge.execute(widgetId);

await OpenAge.challenge(params);
```

Runtime errors keep the popup open long enough to explain what happened.
If no camera is available, OpenAge tells the user to plug one in and closes
the popup automatically after 5 seconds.

## Main Params

| Param     | Values                            |
| --------- | --------------------------------- |
| `mode`    | `serverless`, `sitekey`, `custom` |
| `theme`   | `light`, `dark`, `auto`           |
| `size`    | `normal`, `compact`, `invisible`  |
| `minAge`  | number, default `18`              |
| `sitekey` | required for hosted mode          |
| `server`  | required for custom mode          |

## Demo

- Static demo: https://tn3w.github.io/OpenAge/
- Local server demo:

```bash
cd server
pip install -r requirements.txt
python server.py
```

The repository also includes `demo/`, a minimal GitHub Pages build that loads
the jsDelivr bundle for `@tn3w/openage` in embedded `serverless` mode.

## Development

```bash
npm install
npm test
npm run build
npm run dev
```

Optional server:

```bash
cd server
pip install -r requirements.txt
python server.py
```

## Formatting

```bash
pip install black isort
isort . && black .
npx prtfm
clang-format -i server/wasm/src/*.c server/wasm/src/*.h
```

## License

[Apache 2.0](LICENSE)
