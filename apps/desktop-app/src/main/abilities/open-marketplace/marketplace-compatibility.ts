interface ParsedAppVersion {
	core: readonly [number, number, number];
	prerelease: readonly string[];
}

const APP_VERSION_PATTERN =
	/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseAppVersion(value: string): ParsedAppVersion | null {
	const match = APP_VERSION_PATTERN.exec(value.trim());
	if (!match) return null;
	const core = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
	if (!core.every(Number.isSafeInteger)) return null;
	const prerelease = match[4]?.split(".") ?? [];
	if (
		prerelease.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"))
	) {
		return null;
	}
	return { core, prerelease };
}

export function isValidAppVersion(value: string): boolean {
	return parseAppVersion(value) !== null;
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
	if (left.length === 0 || right.length === 0) {
		if (left.length === right.length) return 0;
		return left.length === 0 ? 1 : -1;
	}
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const leftIdentifier = left[index];
		const rightIdentifier = right[index];
		if (leftIdentifier === undefined || rightIdentifier === undefined) {
			if (leftIdentifier === rightIdentifier) return 0;
			return leftIdentifier === undefined ? -1 : 1;
		}
		if (leftIdentifier === rightIdentifier) continue;
		const leftNumeric = /^\d+$/.test(leftIdentifier);
		const rightNumeric = /^\d+$/.test(rightIdentifier);
		if (leftNumeric && rightNumeric) {
			if (leftIdentifier.length !== rightIdentifier.length) {
				return leftIdentifier.length < rightIdentifier.length ? -1 : 1;
			}
			return leftIdentifier < rightIdentifier ? -1 : 1;
		}
		if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
		return leftIdentifier < rightIdentifier ? -1 : 1;
	}
	return 0;
}

export function compareAppVersions(left: string, right: string): number {
	const parsedLeft = parseAppVersion(left);
	const parsedRight = parseAppVersion(right);
	if (!parsedLeft || !parsedRight) throw new Error(`Invalid app version comparison: ${left}, ${right}`);
	for (let index = 0; index < parsedLeft.core.length; index += 1) {
		const leftPart = parsedLeft.core[index];
		const rightPart = parsedRight.core[index];
		if (leftPart === rightPart) continue;
		return leftPart < rightPart ? -1 : 1;
	}
	return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

export function isAppVersionCompatible(appVersion: string, minAppVersion: string): boolean {
	return compareAppVersions(appVersion, minAppVersion) >= 0;
}
