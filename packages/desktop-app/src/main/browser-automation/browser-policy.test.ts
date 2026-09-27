import { describe, expect, it } from "vitest";
import { assertAllowedBrowserUrl, assertReturnedPageAllowed } from "./browser-policy.js";
import { BrowserAutomationError } from "./contracts.js";

describe("assertAllowedBrowserUrl", () => {
	it("allows when allowedHosts is empty", () => {
		expect(assertAllowedBrowserUrl("https://evil.com/page", [])).toBe("https://evil.com/page");
		expect(assertAllowedBrowserUrl("https://evil.com/page", undefined)).toBe("https://evil.com/page");
	});

	it("allows exact host match", () => {
		expect(assertAllowedBrowserUrl("https://github.com/astravia-core/astravia", ["github.com"])).toBe(
			"https://github.com/astravia-core/astravia",
		);
	});

	it("allows wildcard subdomain", () => {
		expect(assertAllowedBrowserUrl("https://a.github.com/x", ["*.github.com"])).toBe("https://a.github.com/x");
		expect(assertAllowedBrowserUrl("https://b.c.github.com/x", ["*.github.com"])).toBe("https://b.c.github.com/x");
	});

	it("rejects bare domain when wildcard only", () => {
		expect(() => assertAllowedBrowserUrl("https://github.com/x", ["*.github.com"])).toThrow(BrowserAutomationError);
	});

	it("rejects non-matching host", () => {
		expect(() => assertAllowedBrowserUrl("https://evil.com/x", ["github.com"])).toThrow(BrowserAutomationError);
	});

	it("normalizes and trims", () => {
		expect(assertAllowedBrowserUrl("  https://github.com/x  ", ["github.com"])).toBe("https://github.com/x");
	});

	it("rejects invalid URL", () => {
		expect(() => assertAllowedBrowserUrl("not a url", ["github.com"])).toThrow(BrowserAutomationError);
	});
});

describe("assertReturnedPageAllowed", () => {
	it("passes when hosts empty", () => {
		expect(() => assertReturnedPageAllowed("https://evil.com/x", [])).not.toThrow();
	});

	it("passes when host in allowed list", () => {
		expect(() => assertReturnedPageAllowed("https://github.com/x", ["github.com"])).not.toThrow();
	});

	it("throws policy_escape when returned host not in allowed list", () => {
		const err = (() => {
			try {
				assertReturnedPageAllowed("https://evil.com/x", ["github.com"]);
				return null;
			} catch (e) {
				return e as BrowserAutomationError;
			}
		})();
		expect(err).not.toBeNull();
		expect(err?.code).toBe("policy_escape");
	});
});
