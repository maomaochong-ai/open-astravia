const OPAQUE_RESOURCE_QUERY_KEYS = new Set(["inline", "raw", "url"]);

/**
 * These Vite queries expose the requested file as a JavaScript value rather
 * than executing the file as a module or applying it as a stylesheet. Their
 * internal loader relationships are implementation details, not dependencies
 * that a consumer would request separately.
 */
export function hasOpaqueResourceQuery(id: string): boolean {
	const queryIndex = id.indexOf("?");
	if (queryIndex === -1) return false;
	const query = new URLSearchParams(id.slice(queryIndex + 1));
	for (const key of OPAQUE_RESOURCE_QUERY_KEYS) {
		if (query.has(key)) return true;
	}
	return false;
}
