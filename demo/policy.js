const DEFAULT_THRESHOLD = 18;
const SAFETY_MARGIN = 3;
const FAIL_FLOOR = 15;

export function decide(ageResults, threshold = DEFAULT_THRESHOLD) {
    if (!ageResults || ageResults.length === 0) {
        return {
            outcome: 'retry',
            estimatedAge: null,
            confidence: 0,
        };
    }

    const ages = ageResults.map((r) => r.age).sort((a, b) => a - b);
    const trimmedAges = ages.length >= 3 ? ages.slice(1, -1) : ages;

    const estimatedAge = trimmedAges.reduce((sum, a) => sum + a, 0) / trimmedAges.length;

    const passThreshold = threshold + SAFETY_MARGIN;

    if (estimatedAge >= passThreshold) {
        return {
            outcome: 'pass',
            estimatedAge,
            confidence: 1,
        };
    }

    if (estimatedAge < FAIL_FLOOR) {
        return {
            outcome: 'fail',
            estimatedAge,
            confidence: 1,
        };
    }

    return {
        outcome: 'retry',
        estimatedAge,
        confidence: 0.5,
    };
}
