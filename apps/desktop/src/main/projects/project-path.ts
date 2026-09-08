/** Project identity follows the existing Desktop convention: case-insensitive and separator-agnostic. */
export function sameProjectPath(first: string, second: string): boolean {
	const normalize = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	return normalize(first) === normalize(second);
}
