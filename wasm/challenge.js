(function () {
    if (__vm_check() !== 0) return JSON.stringify({ error: 'integrity_fail' });

    var challenge = JSON.parse(__vm_get_challenge());

    function fail(err) {
        return JSON.stringify({
            nonce: challenge.nonce,
            round: challenge.round,
            error: err,
        });
    }

    var face = JSON.parse(__vm_get_face_data());

    function safeNumber(value, fallback) {
        return typeof value === 'number' && isFinite(value) ? value : fallback;
    }

    function normalizeFrame(frame) {
        var headPose = (frame && frame.headPose) || {};
        var blendshapes = (frame && frame.blendshapes) || {};
        var boundingBox = (frame && frame.boundingBox) || {};
        var width = safeNumber(boundingBox.width, 0);
        var height = safeNumber(boundingBox.height, 0);
        return {
            ts: safeNumber(frame && frame.ts, 0),
            headPose: {
                yaw: safeNumber(headPose.yaw, 0),
                pitch: safeNumber(headPose.pitch, 0),
                roll: safeNumber(headPose.roll, 0),
            },
            blendshapes: blendshapes,
            boundingBox: {
                x: safeNumber(boundingBox.x, 0),
                y: safeNumber(boundingBox.y, 0),
                width: width,
                height: height,
                area: safeNumber(boundingBox.area, width * height),
            },
        };
    }

    if (!face || !face.facePresent) return fail('no_face');
    if (face.faceCount !== 1) return fail('bad_face_count');

    var motionHistory = (face.motionHistory || []).map(normalizeFrame);
    if (motionHistory.length < 5) return fail('insufficient_motion');

    var last = motionHistory[motionHistory.length - 1];
    var box = last.boundingBox || {};
    var boxArg =
        (box.x || 0) + ',' + (box.y || 0) + ',' + (box.width || 1) + ',' + (box.height || 1);

    var BURST_FRAMES = 5;
    var AGE_ADJUSTMENT = 2;
    var PASS_THRESHOLD = 18;
    var FAIL_FLOOR = 15;
    var ageReadings = [];
    for (var bi = 0; bi < BURST_FRAMES; bi++) {
        var ageResult = JSON.parse(__vm_infer_age(boxArg));
        if (ageResult && typeof ageResult.age === 'number' && ageResult.age > 0) {
            ageReadings.push(ageResult.age);
        }
    }

    var rawAge = null;
    var age = null;
    if (ageReadings.length > 0) {
        ageReadings.sort(function (a, b) {
            return a - b;
        });
        var trimmed = ageReadings.length >= 3 ? ageReadings.slice(1, -1) : ageReadings;
        var sum = 0;
        for (var si = 0; si < trimmed.length; si++) sum += trimmed[si];
        rawAge = sum / trimmed.length;
        age = rawAge - AGE_ADJUSTMENT;
    }

    function detectYawShift(h, targetDelta) {
        if (h.length < 5) return false;
        var baseYaw = h[0].headPose.yaw;
        var direction = targetDelta > 0 ? 1 : -1;
        var threshold = Math.abs(targetDelta);
        for (var i = 0; i < h.length; i++) {
            if ((h[i].headPose.yaw - baseYaw) * direction > threshold) return true;
        }
        return false;
    }

    function detectNod(h) {
        if (h.length < 10) return false;
        var basePitch = h[0].headPose.pitch;
        var wentDown = false;
        var cameBack = false;
        for (var i = 0; i < h.length; i++) {
            var delta = h[i].headPose.pitch - basePitch;
            if (delta > 15) wentDown = true;
            if (wentDown && Math.abs(delta) < 8) cameBack = true;
        }
        return wentDown && cameBack;
    }

    function detectDoubleBlink(h) {
        if (h.length < 10) return false;
        var blinkCount = 0;
        var eyesClosed = false;
        for (var i = 0; i < h.length; i++) {
            var left = h[i].blendshapes.eyeBlinkLeft || 0;
            var right = h[i].blendshapes.eyeBlinkRight || 0;
            var both = left > 0.6 && right > 0.6;
            if (both && !eyesClosed) {
                blinkCount++;
                eyesClosed = true;
            } else if (!both) {
                eyesClosed = false;
            }
        }
        return blinkCount >= 2;
    }

    function detectDistanceChange(h) {
        if (h.length < 10) return false;
        var baseArea = h[0].boundingBox.area;
        var wentCloser = false;
        var cameBack = false;
        for (var i = 0; i < h.length; i++) {
            var ratio = h[i].boundingBox.area / baseArea;
            if (ratio > 1.3) wentCloser = true;
            if (wentCloser && ratio < 1.15) cameBack = true;
        }
        return wentCloser && cameBack;
    }

    function validateLiveness(task, h) {
        if (task === 'turn-left') return detectYawShift(h, 20);
        if (task === 'turn-right') return detectYawShift(h, -20);
        if (task === 'nod') return detectNod(h);
        if (task === 'blink-twice') return detectDoubleBlink(h);
        if (task === 'move-closer') return detectDistanceChange(h);
        return false;
    }

    function isSuspicious(h) {
        if (h.length < 5) return false;
        var deltas = [];
        for (var i = 1; i < h.length; i++) {
            var dYaw = Math.abs(h[i].headPose.yaw - h[i - 1].headPose.yaw);
            var dPitch = Math.abs(h[i].headPose.pitch - h[i - 1].headPose.pitch);
            deltas.push(dYaw + dPitch);
        }
        var allZero = true;
        for (var i = 0; i < deltas.length; i++) {
            if (deltas[i] >= 0.1) {
                allZero = false;
                break;
            }
        }
        if (allZero) return true;
        var sum = 0;
        for (var i = 0; i < deltas.length; i++) sum += deltas[i];
        var mean = sum / deltas.length;
        var varSum = 0;
        for (var i = 0; i < deltas.length; i++) varSum += (deltas[i] - mean) * (deltas[i] - mean);
        var variance = varSum / deltas.length;
        if (variance < 0.01 && mean > 0.5) return true;
        return false;
    }

    function ageDecision(a) {
        if (typeof a !== 'number' || !isFinite(a)) return 'insufficient_data';
        if (a >= PASS_THRESHOLD) return 'pass';
        if (a < FAIL_FLOOR) return 'fail';
        return 'retry';
    }

    if (isSuspicious(motionHistory)) return fail('suspicious_motion');

    var livenessOk = validateLiveness(challenge.task, motionHistory);
    var ageOutcome = ageDecision(age);

    var last = motionHistory[motionHistory.length - 1];

    return JSON.stringify({
        nonce: challenge.nonce,
        round: challenge.round,
        task: challenge.task,
        age: age,
        rawAge: rawAge,
        ageAdjustment: AGE_ADJUSTMENT,
        faceCount: face.faceCount,
        headPose: last.headPose,
        blendshapes: last.blendshapes,
        motionHistory: motionHistory,
        livenessOk: livenessOk,
        ageOutcome: ageOutcome,
        integrity: __vm_integrity(),
        ts: __vm_ts(),
    });
})();
