import { describe, expect, it } from "vitest";
import {
	DEFAULT_PROXY_CONFIG,
	type DesktopProxyConfig,
	mergeProxyConfigPatch,
	normalizeProxyConfig,
	redactProxyConfig,
} from "./proxy-settings.js";

function stored(overrides: Partial<DesktopProxyConfig> = {}): DesktopProxyConfig {
	return { ...DEFAULT_PROXY_CONFIG, enabled: true, host: "proxy.example.com", port: 3128, ...overrides };
}

describe("normalizeProxyConfig", () => {
	it("falls back to the disabled default for junk input", () => {
		expect(normalizeProxyConfig(undefined)).toEqual(DEFAULT_PROXY_CONFIG);
		expect(normalizeProxyConfig("nope")).toEqual(DEFAULT_PROXY_CONFIG);
	});

	it("accepts a numeric string port so a text input round-trips", () => {
		expect(normalizeProxyConfig({ ...stored(), port: "1080" }).port).toBe(1080);
	});

	it("keeps an out-of-range port instead of clamping it", () => {
		// 夹紧会把「用户填错了」悄悄变成「连到别的端口」，校验留给 resolveProxyConfig。
		expect(normalizeProxyConfig({ ...stored(), port: 99999 }).port).toBe(99999);
	});

	it("rejects an unknown protocol", () => {
		expect(normalizeProxyConfig({ ...stored(), protocol: "socks5" }).protocol).toBe("http");
	});

	it("does not trim the password, whose spaces may be meaningful", () => {
		expect(normalizeProxyConfig({ ...stored(), password: " secret " }).password).toBe(" secret ");
	});
});

describe("redactProxyConfig", () => {
	it("never hands the password to the renderer", () => {
		const snapshot = redactProxyConfig(stored({ password: "hunter2" }));

		expect(snapshot).not.toHaveProperty("password");
		expect(snapshot.passwordConfigured).toBe(true);
		expect(JSON.stringify(snapshot)).not.toContain("hunter2");
	});

	it("reports no stored password when there is none", () => {
		expect(redactProxyConfig(stored()).passwordConfigured).toBe(false);
	});
});

describe("mergeProxyConfigPatch", () => {
	it("keeps the stored password when the patch omits it", () => {
		const next = mergeProxyConfigPatch(stored({ password: "hunter2" }), { host: "other.example.com" });

		expect(next).toMatchObject({ host: "other.example.com", password: "hunter2" });
	});

	it("clears the password on an explicit empty string", () => {
		const next = mergeProxyConfigPatch(stored({ password: "hunter2" }), { password: "" });

		expect(next.password).toBe("");
	});

	it("starts from the disabled default when nothing is stored yet", () => {
		expect(mergeProxyConfigPatch(undefined, { enabled: true, host: "p.example.com", port: 8080 })).toEqual({
			...DEFAULT_PROXY_CONFIG,
			enabled: true,
			host: "p.example.com",
			port: 8080,
		});
	});
});
