import { describe, expect, it } from "vitest";
import {
	buildProxyUrl,
	isValidProxyHost,
	type ProxyConfig,
	resolveProxyConfig,
	shouldBypassProxy,
} from "../src/utils/proxy-config.js";

function config(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
	return { enabled: true, protocol: "http", host: "127.0.0.1", port: 7890, ...overrides };
}

describe("resolveProxyConfig", () => {
	it("treats a disabled or absent config as direct", () => {
		expect(resolveProxyConfig(undefined)).toEqual({ mode: "direct" });
		expect(resolveProxyConfig(config({ enabled: false }))).toEqual({ mode: "direct" });
	});

	it("resolves an enabled config to a proxy url plus a credential-free target", () => {
		expect(resolveProxyConfig(config({ host: "proxy.example.com", port: 3128 }))).toEqual({
			mode: "proxy",
			url: "http://proxy.example.com:3128",
			target: "proxy.example.com:3128",
		});
	});

	it("reports invalid rather than falling back to direct", () => {
		// 静默降级为直连会让用户以为出口 IP 被代理保护着，实际却在裸奔。
		expect(resolveProxyConfig(config({ host: "  " }))).toEqual({ mode: "invalid", reason: "invalid-host" });
		expect(resolveProxyConfig(config({ port: 0 }))).toEqual({ mode: "invalid", reason: "invalid-port" });
		expect(resolveProxyConfig(config({ port: 70000 }))).toEqual({ mode: "invalid", reason: "invalid-port" });
		expect(resolveProxyConfig(config({ protocol: "socks5" as never }))).toEqual({
			mode: "invalid",
			reason: "invalid-protocol",
		});
	});

	it("keeps the proxy target free of credentials while the url carries them", () => {
		const resolution = resolveProxyConfig(config({ username: "user", password: "p@ss:word/1" }));
		expect(resolution).toMatchObject({ mode: "proxy", target: "127.0.0.1:7890" });
		expect(resolution).not.toMatchObject({ target: expect.stringContaining("p@ss") });
	});

	it("brackets a bare IPv6 proxy host", () => {
		expect(resolveProxyConfig(config({ host: "::1", port: 8080 }))).toEqual({
			mode: "proxy",
			url: "http://[::1]:8080",
			target: "[::1]:8080",
		});
	});
});

describe("buildProxyUrl", () => {
	it("percent-encodes credentials so a password cannot rewrite the url", () => {
		expect(buildProxyUrl(config({ username: "a b", password: "p@ss:/word" }))).toBe(
			"http://a%20b:p%40ss%3A%2Fword@127.0.0.1:7890",
		);
	});
});

describe("isValidProxyHost", () => {
	it("rejects hosts whose characters would rewrite the proxy url", () => {
		for (const host of ["evil.com/path", "user@evil.com", "a b", "host#frag", "host?q", "10.0.0.1:1"]) {
			expect(isValidProxyHost(host)).toBe(false);
		}
	});

	it("accepts hostnames, IPv4 and IPv6 forms", () => {
		for (const host of ["proxy.example.com", "127.0.0.1", "::1", "[::1]", "fe80::1"]) {
			expect(isValidProxyHost(host)).toBe(true);
		}
	});
});

describe("shouldBypassProxy", () => {
	it("bypasses loopback targets so local model servers stay reachable", () => {
		for (const url of [
			"http://localhost:11434/v1",
			"http://127.0.0.1:1234",
			"http://127.5.6.7/x",
			"http://[::1]:8080",
		]) {
			expect(shouldBypassProxy(url)).toBe(true);
		}
	});

	it("bypasses LAN targets so a self-hosted gateway or model server stays reachable", () => {
		// CLIProxyAPI 桥接网关、局域网推理机绕外网代理出去必然连不上。
		for (const url of [
			"http://192.168.50.50:8124/v1",
			"http://10.1.2.3:8000",
			"http://172.20.0.5/v1",
			"http://169.254.1.1/",
			"http://gateway.local:3000",
			"http://[fe80::1]:8080",
			"http://[fd00::1]/",
		]) {
			expect(shouldBypassProxy(url)).toBe(true);
		}
	});

	it("does not bypass remote targets", () => {
		for (const url of [
			"https://api.anthropic.com/v1",
			"https://127.0.0.1.evil.com/",
			"http://172.32.0.1/",
			"http://11.0.0.1/",
			"http://192.169.0.1/",
		]) {
			expect(shouldBypassProxy(url)).toBe(false);
		}
	});
});
