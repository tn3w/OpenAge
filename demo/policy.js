const DEFAULT_THRESHOLD = 18;
const FAIL_FLOOR = 15;

export function decide(ageResults, threshold = DEFAULT_THRESHOLD) {
    if (!ageResults || ageResults.length === 0) {
        return {
            outcome: 'retry',
            estimatedAge: null,
            reason: 'No reliable age estimate was produced',
        };
    }

    const ages = ageResults.map((r) => r.age).sort((a, b) => a - b);
    const trimmedAges = ages.length >= 3 ? ages.slice(1, -1) : ages;

    const estimatedAge = trimmedAges.reduce((sum, a) => sum + a, 0) / trimmedAges.length;

    if (estimatedAge >= threshold) {
        return {
            outcome: 'pass',
            estimatedAge,
            reason: null,
        };
    }

    if (estimatedAge < FAIL_FLOOR) {
        return {
            outcome: 'fail',
            estimatedAge,
            reason: `Pass threshold stays at ${threshold}. ` + `Values below ${FAIL_FLOOR} fail`,
        };
    }

    return {
        outcome: 'retry',
        estimatedAge,
        reason: `Pass threshold stays at ${threshold}`,
    };
}
