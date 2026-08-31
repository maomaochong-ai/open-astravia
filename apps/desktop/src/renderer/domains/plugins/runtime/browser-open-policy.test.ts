import { describe, expect, it } from "vitest";
import { normalizeBrowserOpenUrl } from "./browser-open-policy";

describe("normalizeBrowserOpenUrl", () => {
	it("adds https and preserves a valid path/query", () => {
		expect(normalizeBrowserOpenUrl("example.com/posts?draft=1", ["example.com"])).toBe(
			"https://example.com/posts?draft=1",
		);
	});

	it("supports wildcard hosts but rejects sibling domains", () => {
		expect(normalizeBrowserOpenUrl("https://studio.example.com", ["*.example.com"])).toBe(
			"https://studio.example.com/",
		);
		expect(() => normalizeBrowserOpenUrl("https://example.net", ["*.example.com"])).toThrow("not allowed");
	});

	it("rejects non-http protocols and empty input", () => {
		expect(() => normalizeBrowserOpenUrl("javascript:alert(1)", ["*"])).toThrow("HTTP and HTTPS");
		expect(() => normalizeBrowserOpenUrl("  ", ["*"])).toThrow("required");
	});
});
