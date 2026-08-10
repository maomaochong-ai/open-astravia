export function resolveSupportedModelOption<Value>(
	value: Value | undefined,
	options: readonly Value[] | undefined,
): Value | undefined {
	if (!options || options.length === 0) return undefined;
	return value !== undefined && options.includes(value) ? value : options[0];
}
