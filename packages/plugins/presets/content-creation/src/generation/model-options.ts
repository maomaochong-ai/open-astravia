export function resolveSupportedModelOption<Value>(
	value: Value | undefined,
	options: readonly Value[] | undefined,
	defaultValue?: Value,
): Value | undefined {
	if (!options || options.length === 0) return undefined;
	if (value !== undefined && options.includes(value)) return value;
	return defaultValue !== undefined && options.includes(defaultValue) ? defaultValue : options[0];
}
