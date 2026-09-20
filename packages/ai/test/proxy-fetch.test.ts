import { describe, expect, it, vi } from "vitest";
import type { ProxyConfig } from "../src/utils/proxy-config.js";
import { createProxyFetch, ProxyConfigurationError } from "../src/utils/proxy-fetch.js";

function config(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
	return { enabled: true, protocol: "http", host: "proxy.example.com", port: 3128, ...overrides };
}

function fakeDispatcherLoader() {
	const close = vi.fn(async () => {});
	const load = vi.fn(async (_proxyUrl: string) => ({ close }));
	return { load, close };
}

function okResponse(): Response {
	return new Response("ok", { status: 200 });
}

describe("createProxyFetch", () => {
	it("returns nothing for a direct config so callers keep their own fetch", () => {
		expect(createProxyFetch(undefined)).toBeUndefined();
		expect(createProxyFetch(config({ enabled: false }))).toBeUndefined();
	});

	it("sends remote requests through the proxy dispatcher", async () => {
		const baseFetch = vi.fn(async () => okResponse());
		const dispatcher = fakeDispatcherLoader();

		const proxied = createProxyFetch(config(), { baseFetch, loadDispatcher: dispatcher.load });
		await proxied?.fetch("https://api.anthropic.com/v1/messages", { method: "POST" });

		expect(dispatcher.load).toHaveBeenCalledWith("http://proxy.example.com:3128");
		const [, init] = baseFetch.mock.calls[0] ?? [];
		expect(init).toMatchObject({
			method: "POST",
			dispatcher: expect.objectContaining({ close: expect.any(Function) }),
		});
	});

	it("sends loopback requests directly so a local model server still works", async () => {
		const baseFetch = vi.fn(async () => okResponse());
		const dispatcher = fakeDispatcherLoader();

		const proxied = createProxyFetch(config(), { baseFetch, loadDispatcher: dispatcher.load });
		await proxied?.fetch("http://127.0.0.1:11434/v1/chat/completions");

		expect(dispatcher.load).not.toHaveBeenCalled();
		const [, init] = baseFetch.mock.calls[0] ?? [];
		expect(init).not.toMatchObject({ dispatcher: expect.anything() });
	});

	it("reuses one dispatcher across requests instead of rebuilding the tunnel", async () => {
		const baseFetch = vi.fn(async () => okResponse());
		const dispatcher = fakeDispatcherLoader();

		const proxied = createProxyFetch(config(), { baseFetch, loadDispatcher: dispatcher.load });
		await proxied?.fetch("https://api.openai.com/v1/models");
		await proxied?.fetch("https://api.openai.com/v1/models");

		expect(dispatcher.load).toHaveBeenCalledOnce();
	});

	it("fails every request when the proxy config is invalid rather than going direct", async () => {
		const baseFetch = vi.fn(async () => okResponse());

		const proxied = createProxyFetch(config({ host: "" }), { baseFetch });

		await expect(proxied?.fetch("https://api.anthropic.com/v1/messages")).rejects.toBeInstanceOf(
			ProxyConfigurationError,
		);
		expect(baseFetch).not.toHaveBeenCalled();
	});

	it("closes the dispatcher on dispose", async () => {
		const baseFetch = vi.fn(async () => okResponse());
		const dispatcher = fakeDispatcherLoader();

		const proxied = createProxyFetch(config(), { baseFetch, loadDispatcher: dispatcher.load });
		await proxied?.fetch("https://api.openai.com/v1/models");
		await proxied?.dispose();

		expect(dispatcher.close).toHaveBeenCalledOnce();
	});
});
