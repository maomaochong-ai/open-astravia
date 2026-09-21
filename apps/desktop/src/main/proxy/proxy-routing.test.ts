import { describe, expect, it } from "vitest";
import { decideProxyRouting, type ProxyRoutingDecisionInput } from "./proxy-routing.js";

function input(overrides: Partial<ProxyRoutingDecisionInput> = {}): ProxyRoutingDecisionInput {
	return {
		proxyActive: true,
		providerUseProxy: undefined,
		api: "anthropic-messages",
		baseUrl: "https://api.anthropic.com",
		...overrides,
	};
}

describe("decideProxyRouting", () => {
	it("goes direct while the application proxy is off", () => {
		expect(decideProxyRouting(input({ proxyActive: false, providerUseProxy: true }))).toBe("direct");
	});

	it("proxies a provider that has not opted out, because enabling a proxy means 'route my traffic'", () => {
		expect(decideProxyRouting(input())).toBe("proxy");
	});

	it("honours an explicit per-provider exclusion", () => {
		expect(decideProxyRouting(input({ api: "openai-completions", providerUseProxy: false }))).toBe("direct");
	});

	it("keeps vendor-SDK APIs on the global dispatcher whichever way their switch is set", () => {
		// 它们够不到注入的传输，开关拨到哪边都改变不了去向；谎称排除成功比不支持更糟。
		for (const api of ["bedrock-converse-stream", "google-generative-ai", "google-vertex"] as const) {
			expect(decideProxyRouting(input({ api, providerUseProxy: true }))).toBe("follows-global");
			expect(decideProxyRouting(input({ api, providerUseProxy: false }))).toBe("follows-global");
		}
	});

	it("never proxies an upstream that sits on this machine or the LAN", () => {
		// CLIProxyAPI 这类本机桥接网关、局域网模型服务，绕外网代理出去必然连不上。
		for (const baseUrl of [
			"http://127.0.0.1:49507/v1beta",
			"http://localhost:11434/v1",
			"http://192.168.50.50:8124/v1",
			"http://10.1.2.3:8000",
			"http://[fe80::1]:8080",
			"http://gateway.local:3000",
		]) {
			expect(decideProxyRouting(input({ baseUrl, providerUseProxy: true }))).toBe("always-local");
		}
	});

	it("treats a local upstream as local even when its API cannot take an injected transport", () => {
		// 本机这一跳根本没出网，SDK 支不支持注入与它无关。
		expect(decideProxyRouting(input({ api: "google-generative-ai", baseUrl: "http://127.0.0.1:49507/v1beta" }))).toBe(
			"always-local",
		);
	});
});
