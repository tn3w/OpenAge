const DEFAULT_THRESHOLD = 18;
const FAIL_FLOOR = 15;
const AGE_ADJUSTMENT = 2;

export function decide(ageResults, threshold = DEFAULT_THRESHOLD) {
    if (!ageResults || ageResults.length === 0) {
        return {
            outcome: 'retry',
            estimatedAge: null,
            rawEstimatedAge: null,
            confidence: 0,
            ageAdjustment: AGE_ADJUSTMENT,
            passThreshold: threshold,
            reason: 'No reliable age estimate was produced',
        };
    }

    const ages = ageResults.map((r) => r.age).sort((a, b) => a - b);
    const trimmedAges = ages.length >= 3 ? ages.slice(1, -1) : ages;

    const rawEstimatedAge = trimmedAges.reduce((sum, a) => sum + a, 0) / trimmedAges.length;
    const estimatedAge = rawEstimatedAge - AGE_ADJUSTMENT;

    if (estimatedAge >= threshold) {
        return {
            outcome: 'pass',
            estimatedAge,
            rawEstimatedAge,
            confidence: 1,
            ageAdjustment: AGE_ADJUSTMENT,
            passThreshold: threshold,
            reason: null,
        };
    }

    if (estimatedAge < FAIL_FLOOR) {
        return {
            outcome: 'fail',
            estimatedAge,
            rawEstimatedAge,
            confidence: 1,
            ageAdjustment: AGE_ADJUSTMENT,
            passThreshold: threshold,
            reason:
                `Demo passes at ${threshold}+ after applying the -${AGE_ADJUSTMENT} ` +
                `adjustment and values below ${FAIL_FLOOR} fail`,
        };
    }

    return {
        outcome: 'retry',
        estimatedAge,
        rawEstimatedAge,
        confidence: 0.5,
        ageAdjustment: AGE_ADJUSTMENT,
        passThreshold: threshold,
        reason: `Demo passes at ${threshold}+ after applying the -${AGE_ADJUSTMENT} adjustment`,
    };
}
