export function isLegacySessionHeader(firstLine: string | undefined): boolean {
	if (!firstLine) return false;
	try {
		const value: unknown = JSON.parse(firstLine);
		return (
			typeof value === "object" &&
			value !== null &&
			"type" in value &&
			value.type === "session" &&
			"cwd" in value &&
			typeof value.cwd === "string"
		);
	} catch {
		return false;
	}
}
