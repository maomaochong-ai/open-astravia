/**
 * Match a normalized browser hostname against plugin-declared host patterns.
 * URL parsing and error mapping stay at each process boundary; this helper
 * contains only the shared, side-effect-free host policy.
 */
export function isAllowedBrowserHost(host: string, allowedHosts: readonly string[]): boolean {
	const normalizedHost = host.toLowerCase().replace(/\.$/, "");
	return allowedHosts.some((pattern) => {
		const normalizedPattern = pattern.trim().toLowerCase().replace(/\.$/, "");
		if (normalizedPattern === "*") return true;
		if (normalizedPattern.startsWith("*.")) {
			const bare = normalizedPattern.slice(2);
			return normalizedHost === bare || normalizedHost.endsWith(`.${bare}`);
		}
		return normalizedHost === normalizedPattern;
	});
}
