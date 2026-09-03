import type { McpAppPermission, McpAppResourceCsp, McpAppResourceMeta } from "@vetta/runtime-mcp";

const CSP_SEPARATOR = /["'`\s;,]/;

export function buildMcpAppCsp(csp?: McpAppResourceCsp): string {
	const connect = sanitizeOrigins(csp?.connectDomains, true);
	const resources = sanitizeOrigins(csp?.resourceDomains, false);
	const frames = sanitizeOrigins(csp?.frameDomains, false);
	const bases = sanitizeOrigins(csp?.baseUriDomains, false);
	return [
		"default-src 'none'",
		"object-src 'none'",
		`base-uri ${bases.length > 0 ? bases.join(" ") : "'none'"}`,
		"form-action 'none'",
		`script-src 'unsafe-inline' ${resources.join(" ")}`.trim(),
		`style-src 'unsafe-inline' ${resources.join(" ")}`.trim(),
		`img-src data: ${resources.join(" ")}`.trim(),
		`media-src data: ${resources.join(" ")}`.trim(),
		`font-src ${resources.length > 0 ? resources.join(" ") : "'none'"}`,
		`connect-src ${connect.length > 0 ? connect.join(" ") : "'none'"}`,
		`frame-src ${frames.length > 0 ? frames.join(" ") : "'none'"}`,
		"worker-src 'none'",
	].join("; ");
}

export function buildMcpAppAllow(
	meta: McpAppResourceMeta | undefined,
	allowed: readonly McpAppPermission[] = [],
): string | undefined {
	const requested = meta?.permissions;
	if (!requested || allowed.length === 0) return undefined;
	const features: Record<McpAppPermission, string> = {
		camera: "camera",
		microphone: "microphone",
		geolocation: "geolocation",
		clipboardWrite: "clipboard-write",
	};
	const granted = allowed
		.filter((permission) => requested[permission] !== undefined)
		.map((permission) => features[permission]);
	return granted.length > 0 ? granted.join("; ") : undefined;
}

function sanitizeOrigins(values: readonly string[] | undefined, allowWebSocket: boolean): string[] {
	const origins = new Set<string>();
	for (const value of values ?? []) {
		if (typeof value !== "string" || CSP_SEPARATOR.test(value)) continue;
		const wildcard = value.startsWith("https://*.");
		const candidate = wildcard ? value.replace("https://*.", "https://wildcard.") : value;
		try {
			const url = new URL(candidate);
			if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) continue;
			if (url.protocol !== "https:" && !(allowWebSocket && url.protocol === "wss:")) continue;
			const origin = wildcard ? url.origin.replace("https://wildcard.", "https://*.") : url.origin;
			if (!CSP_SEPARATOR.test(origin)) origins.add(origin);
		} catch {
			// Malformed server metadata is ignored; the resulting policy stays restrictive.
		}
	}
	return [...origins];
}
