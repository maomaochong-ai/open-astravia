import { isAllowedBrowserHost } from "../../../../shared/browser-policy";

/**
 * Validate and normalize a plugin request for the host-owned built-in browser.
 * This policy intentionally mirrors the host navigation boundary without
 * exposing the automation engine or any page data to the plugin.
 */
export function normalizeBrowserOpenUrl(rawUrl: string, allowedHosts: readonly string[]): string {
	const input = rawUrl.trim();
	if (!input) throw new Error("Browser URL is required");
	const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) ? input : `https://${input}`;
	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		throw new Error("Browser URL is invalid");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Built-in browser only accepts HTTP and HTTPS URLs");
	}
	const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
	if (!isAllowedBrowserHost(host, allowedHosts)) {
		throw new Error(`Browser navigation to ${host} is not allowed`);
	}
	return parsed.toString();
}
