const DEFAULT_MAX_RETRIES = 0;

export function resolveProviderMaxRetries(value: number | undefined): number {
	if (value === undefined) return DEFAULT_MAX_RETRIES;
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError("maxRetries must be a non-negative safe integer");
	}
	return value;
}

export function resolveProviderMaxAttempts(value: number | undefined): number {
	return resolveProviderMaxRetries(value) + 1;
}
