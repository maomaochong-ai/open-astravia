import { BrowserAutomationError } from "./contracts.js";

export interface AllowedBrowserUrl {
	url: string;
	host: string;
}

function matchesAllowedHost(host: string, allowedHosts: readonly string[]): boolean {
	return allowedHosts.some((pattern) => {
		if (pattern === "*") return true;
		if (pattern.startsWith("*.")) {
			const bare = pattern.slice(2);
			return host === bare || host.endsWith(`.${bare}`);
		}
		return host === pattern;
	});
}

export function assertAllowedBrowserUrl(rawUrl: string, allowedHosts: readonly string[]): AllowedBrowserUrl {
	const input = rawUrl.trim();
	if (!input) throw new BrowserAutomationError("invalid_request", "Browser URL is required");
	const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) ? input : `https://${input}`;
	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch (error) {
		throw new BrowserAutomationError("invalid_request", "Browser URL is invalid", { cause: error });
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new BrowserAutomationError("policy_denied", "Only HTTP and HTTPS browser navigation is allowed");
	}
	const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
	if (!matchesAllowedHost(host, allowedHosts)) {
		throw new BrowserAutomationError("policy_denied", `Browser navigation to ${host} is not allowed`);
	}
	return { url: parsed.toString(), host };
}

export function assertReturnedPageAllowed(rawUrl: string, allowedHosts: readonly string[]): void {
	if (rawUrl === "about:blank") return;
	assertAllowedBrowserUrl(rawUrl, allowedHosts);
}
