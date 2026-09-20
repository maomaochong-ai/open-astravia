import { describe, expect, it } from "vitest";
import { decideProxyRouting } from "./proxy-routing.js";

describe("decideProxyRouting", () => {
	it("goes direct while the application proxy is off", () => {
		expect(decideProxyRouting({ proxyActive: false, providerUseProxy: true, api: "anthropic-messages" })).toBe(
			"direct",
		);
	});

	it("proxies a provider that has not opted out, because enabling a proxy means 'route my traffic'", () => {
		expect(decideProxyRouting({ proxyActive: true, providerUseProxy: undefined, api: "anthropic-messages" })).toBe(
			"proxy",
		);
	});

	it("honours an explicit per-provider exclusion", () => {
		expect(decideProxyRouting({ proxyActive: true, providerUseProxy: false, api: "openai-completions" })).toBe(
			"direct",
		);
	});

	it("reports vendor-SDK APIs as unsupported rather than pretending the switch worked", () => {
		for (const api of ["bedrock-converse-stream", "google-generative-ai", "google-vertex"] as const) {
			expect(decideProxyRouting({ proxyActive: true, providerUseProxy: true, api })).toBe("unsupported-api");
		}
	});
});
