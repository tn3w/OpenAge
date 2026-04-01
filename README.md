# OpenAge

Privacy-first, open source age verification that runs entirely in the browser. No face data leaves the device.

## Quick Start

```
python server.py
```

Open http://localhost:8000. On first load, models download from CDN (~5 MB total) and cache locally. Subsequent loads work offline.

## GitHub Pages Demo

The repo includes a Pages workflow at [.github/workflows/github-pages.yml](.github/workflows/github-pages.yml) that publishes the contents of [static](static) as a live demo.

Push to `main` or run the workflow manually. In the repository Pages settings, use `GitHub Actions` as the source.

The Pages demo serves the same browser app over HTTPS, so camera access works without the local Python server. The local-only `POST /api/result` telemetry endpoint is simply absent on Pages.

## How It Works

1. **Camera** — requests front camera, checks lighting and blur
2. **Positioning** — confirms exactly one face is visible and stable
3. **Liveness** — 3 randomized challenges (head turns, nods, blinks, distance changes) scored via MediaPipe Face Landmarker landmarks, blendshapes, and head pose
4. **Age estimation** — captures 5 frames, runs face-api.js AgeGenderNet on each, aggregates with trimmed mean
5. **Decision** — pass (estimated age ≥ 21), retry (15–21 uncertainty band), or fail (< 15)

## Architecture

```
server.py                Python stdlib HTTP server + POST /api/result telemetry

static/
  index.html             Single page, all UI states
  style.css              Responsive dark theme, face guide overlay
  app.js                 State machine orchestrator
  camera.js              getUserMedia, frame capture, quality checks
  model-store.js         Cache API wrapper, CDN download, offline support
  face-tracker.js        MediaPipe FaceLandmarker wrapper, head pose extraction
  liveness.js            Challenge-response engine, anti-replay scoring
  age-estimator.js       face-api.js adapter (swappable)
  policy.js              Trimmed mean aggregation, safety margin threshold
```

## UI

Portrait-oriented camera view with an oversized liveness face guide overlaid nearly edge-to-edge on the video feed. Challenge instructions and progress appear as a HUD at the bottom of the viewport. Status text floats at the top. The preview stays clean with no tracker box. Before camera activation, a hero state shows an animated idle face. DM Sans + Space Mono typography, green accent on dark surface.

## Anti-Spoofing

The liveness engine uses active challenge-response rather than passive detection:

- Randomized task order prevents scripted replay
- Temporal continuity and motion smoothness scoring
- Flat/rigid motion flagged as suspicious
- Multiple faces always fail the session
- Response timing validated (0.5s–8s window)

## Age Policy

- Threshold: 18, safety margin: 3 years
- Pass: trimmed mean of burst ≥ 21
- Retry: 15–21 (uncertainty band)
- Fail: < 15 after max 3 attempts → "unable to verify"
- Single-frame decisions are never used

## Privacy

- All inference runs on-device in the browser
- No raw camera frames uploaded
- No face images persisted
- No reusable face embeddings stored
- Telemetry contains only: model version, decision bucket, retry count, timestamp
- "Clear Data" button removes all cached models and session data

## Models

| Model | Source | Size | Purpose |
|-------|--------|------|---------|
| MediaPipe Face Landmarker (float16) | Google Storage | ~4 MB | Landmarks, blendshapes, head pose |
| face-api.js TinyFaceDetector | jsDelivr CDN | 190 KB | Face detection |
| face-api.js FaceLandmark68Tiny | jsDelivr CDN | 80 KB | Landmark alignment |
| face-api.js AgeGenderNet | jsDelivr CDN | 420 KB | Age estimation (MAE 4.54) |

Models are cached via the Cache API after first download and reused offline.

## API

### POST /api/result

Receives non-biometric telemetry. Allowed fields:

```json
{
  "modelVersion": "face-api.js@0.22.2/ageGenderNet",
  "decision": "pass",
  "retryCount": 0,
  "livenessTasksCompleted": 3,
  "timestamp": "2026-04-01T12:00:00.000Z"
}
```

Server logs filtered payload to stdout.

## Configuration

- Port: `python server.py 3000` (default: 8000)
- Age threshold and safety margin: edit constants in `static/policy.js`
- Liveness task count and timeouts: edit constants in `static/liveness.js`

## Browser Support

Requires: getUserMedia, ES modules, Cache API, WebGL (for MediaPipe GPU delegate). Works in current Chrome, Firefox, Edge, Safari.

## License

Open source. See LICENSE file.
