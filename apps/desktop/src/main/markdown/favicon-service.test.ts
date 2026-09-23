import { describe, expect, it } from "vitest";
import { discoverIcons } from "./favicon-service.js";
import { isPublicAddress, readPublicResource } from "./public-resource.js";

describe("Website icon discovery", () => {
	it("resolves declared icons against the first document base, decodes entities and retains conventional fallback", () => {
		const icons = discoverIcons(
			'<base href="/assets/"><link rel="shortcut icon" href="brand.svg?v=1&amp;s=2"><link rel="apple-touch-icon" href="//cdn.example.com/icon.png"><link rel="icon" href="javascript:alert(1)">',
			new URL("https://example.com/docs"),
		);
		expect(icons.map((url) => url.href)).toEqual([
			"https://example.com/assets/brand.svg?v=1&s=2",
			"https://cdn.example.com/icon.png",
			"https://example.com/favicon.ico",
		]);
	});
	it.each([
		"127.0.0.1",
		"10.0.0.1",
		"169.254.169.254",
		"192.168.1.1",
		"::1",
		"::ffff:127.0.0.1",
		"fc00::1",
		"0.0.0.0",
	])("rejects non-public address %s", (address) => expect(isPublicAddress(address)).toBe(false));
	it("allows public IPv4 and IPv6", () => {
		expect(isPublicAddress("8.8.8.8")).toBe(true);
		expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
	});
	it("rejects unsupported schemes, credentials and private destinations before any request", async () => {
		for (const target of [
			"file:///etc/passwd",
			"https://user:password@example.com",
			"http://127.0.0.1",
			"https://example.com:8080",
		]) {
			await expect(readPublicResource(new URL(target), 100, AbortSignal.timeout(1000))).rejects.toThrow();
		}
	});
});
