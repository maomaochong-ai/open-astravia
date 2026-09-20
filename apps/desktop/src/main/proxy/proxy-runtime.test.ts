import type { Api, AssistantMessage, Model, StreamOptions } from "@vetta/ai";
import { getDefaultAdapterRegistry, LanguageModelStream, setProviderFetchResolver, streamSimple } from "@vetta/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDesktopProxy } from "./proxy-runtime.js";
import { DEFAULT_PROXY_CONFIG, type DesktopProxyConfig } from "./proxy-settings.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function proxyConfig(overrides: Partial<DesktopProxyConfig> = {}): DesktopProxyConfig {
	return { ...DEFAULT_PROXY_CONFIG, enabled: true, host: "proxy.example.com", port: 3128, ...overrides };
}

function model(provider: string, api: Api = "openai-completions"): Model<Api> {
	return {
		id: "m",
		name: "M",
		api,
		provider,
		baseUrl: "https://provider.test",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}

function doneMessage(target: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: target.api,
		provider: target.provider,
		model: target.id,
		usage: {
			input: 0,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 1,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

/** 从真正的 streamSimple 入口跑一次，拿到 Provider 适配器实际收到的 options。 */
async function optionsSeenByProvider(target: Model<Api>): Promise<StreamOptions | undefined> {
	const registry = getDefaultAdapterRegistry();
	const original = registry.get(target.api);
	if (!original) throw new Error(`Expected a built-in adapter for ${target.api}`);
	let seen: StreamOptions | undefined;

	registry.register(
		{
			api: target.api,
			async stream(request) {
				seen = request.options;
				const events = new LanguageModelStream();
				events.push({ type: "done", reason: "stop", message: doneMessage(target) });
				return { events, result: events.result() };
			},
			async streamSimple(request) {
				seen = request.options;
				const events = new LanguageModelStream();
				events.push({ type: "done", reason: "stop", message: doneMessage(target) });
				return { events, result: events.result() };
			},
		},
		{ replace: true, sourceId: "proxy-runtime-test" },
	);

	try {
		await streamSimple(target, { messages: [] }).result();
		return seen;
	} finally {
		registry.register(original, { replace: true, sourceId: "built-in" });
	}
}

afterEach(() => {
	setProviderFetchResolver(undefined);
});

describe("应用代理设置流程", () => {
	it("用户填好代理并启用后，未排除的供应商请求走代理，被排除的走直连", async () => {
		const env: NodeJS.ProcessEnv = {};

		const applied = applyDesktopProxy(proxyConfig(), {
			env,
			readProviderUseProxy: (providerId) => (providerId === "deepseek" ? false : undefined),
		});

		expect(applied).toEqual({ mode: "proxy", target: "proxy.example.com:3128" });
		expect((await optionsSeenByProvider(model("anthropic")))?.fetch).toBeTypeOf("function");
		expect((await optionsSeenByProvider(model("deepseek")))?.fetch).toBeUndefined();
	});

	it("用户关掉代理后，供应商请求回到直连", async () => {
		const env: NodeJS.ProcessEnv = {};
		applyDesktopProxy(proxyConfig(), { env, readProviderUseProxy: () => undefined });

		const applied = applyDesktopProxy(proxyConfig({ enabled: false }), {
			env,
			readProviderUseProxy: () => undefined,
		});

		expect(applied).toEqual({ mode: "direct" });
		expect((await optionsSeenByProvider(model("anthropic")))?.fetch).toBeUndefined();
	});

	it("厂商 SDK 自己发请求的 API 拿不到注入传输，不会被假装接管", async () => {
		const env: NodeJS.ProcessEnv = {};

		applyDesktopProxy(proxyConfig(), { env, readProviderUseProxy: () => true });

		expect((await optionsSeenByProvider(model("google", "google-generative-ai")))?.fetch).toBeUndefined();
	});

	it("配置无效时接管请求并让它失败，而不是安静地直连出去", async () => {
		const env: NodeJS.ProcessEnv = {};

		const applied = applyDesktopProxy(proxyConfig({ host: "" }), { env, readProviderUseProxy: () => undefined });

		expect(applied).toEqual({ mode: "invalid" });
		const injected = (await optionsSeenByProvider(model("anthropic")))?.fetch;
		expect(injected).toBeTypeOf("function");
		await expect(injected?.("https://api.anthropic.com/v1/messages")).rejects.toThrow(/invalid/i);
		expect(env.HTTPS_PROXY).toBeUndefined();
	});
});

describe("代理环境变量", () => {
	it("启用后写入代理与环回豁免，供本地命令和自带 SDK 的 Provider 跟随", () => {
		const env: NodeJS.ProcessEnv = {};

		applyDesktopProxy(proxyConfig({ username: "u", password: "p" }), { env, readProviderUseProxy: () => undefined });

		expect(env.HTTPS_PROXY).toBe("http://u:p@proxy.example.com:3128");
		expect(env.http_proxy).toBe("http://u:p@proxy.example.com:3128");
		expect(env.NO_PROXY).toContain("127.0.0.1");
	});

	it("关闭后还原用户本来就导出的代理变量，而不是把它删掉", () => {
		const env: NodeJS.ProcessEnv = { HTTPS_PROXY: "http://shell.example.com:8080" };

		applyDesktopProxy(proxyConfig(), { env, readProviderUseProxy: () => undefined });
		expect(env.HTTPS_PROXY).toBe("http://proxy.example.com:3128");

		applyDesktopProxy(proxyConfig({ enabled: false }), { env, readProviderUseProxy: () => undefined });
		expect(env.HTTPS_PROXY).toBe("http://shell.example.com:8080");
		expect(env.HTTP_PROXY).toBeUndefined();
	});
});
