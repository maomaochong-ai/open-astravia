import type { Api, AssistantMessage, ManagedFetch, Model, StreamOptions } from "@vetta/ai";
import { getDefaultAdapterRegistry, LanguageModelStream, setProviderFetchResolver, streamSimple } from "@vetta/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDesktopProxy, type ProxyRuntimeOptions } from "./proxy-runtime.js";
import { DEFAULT_PROXY_CONFIG, type DesktopProxyConfig } from "./proxy-settings.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function proxyConfig(overrides: Partial<DesktopProxyConfig> = {}): DesktopProxyConfig {
	return { ...DEFAULT_PROXY_CONFIG, enabled: true, host: "proxy.example.com", port: 3128, ...overrides };
}

function model(provider: string, api: Api = "openai-completions", baseUrl = "https://provider.test"): Model<Api> {
	return {
		id: "m",
		name: "M",
		api,
		provider,
		baseUrl,
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

/** 替身：记录全局 dispatcher 的装卸与直连 fetch 的使用，不碰真实 undici。 */
function harness(readProviderUseProxy: ProxyRuntimeOptions["readProviderUseProxy"] = () => undefined) {
	const env: NodeJS.ProcessEnv = {};
	const installed: string[] = [];
	const disposeGlobal = vi.fn(async () => {});
	const directFetch = vi.fn(async () => new Response("ok"));
	const disposeDirect = vi.fn(async () => {});
	const options: ProxyRuntimeOptions = {
		env,
		readProviderUseProxy,
		installGlobalDispatcher: async (proxyUrl) => {
			installed.push(proxyUrl);
			return { dispose: disposeGlobal };
		},
		makeDirectFetch: (): ManagedFetch => ({ fetch: directFetch as never, dispose: disposeDirect }),
	};
	return { env, installed, disposeGlobal, directFetch, disposeDirect, options };
}

afterEach(() => {
	setProviderFetchResolver(undefined);
});

describe("应用代理设置流程", () => {
	it("启用后换掉全局 dispatcher，未排除的供应商不再需要注入传输", async () => {
		const h = harness();

		const applied = await applyDesktopProxy(proxyConfig(), h.options);

		expect(applied).toEqual({ mode: "proxy", target: "proxy.example.com:3128" });
		expect(h.installed).toEqual(["http://proxy.example.com:3128"]);
		// 全局已经在代理上，再注入一层只是重复。
		expect((await optionsSeenByProvider(model("anthropic")))?.fetch).toBeUndefined();
	});

	it("被排除的供应商注入直连传输，把全局代理盖掉", async () => {
		const h = harness((providerId) => (providerId === "deepseek" ? false : undefined));

		await applyDesktopProxy(proxyConfig(), h.options);
		const injected = (await optionsSeenByProvider(model("deepseek")))?.fetch;

		expect(injected).toBeTypeOf("function");
		await injected?.("https://api.deepseek.com/v1/chat/completions");
		expect(h.directFetch).toHaveBeenCalledOnce();
	});

	it("厂商 SDK 自己发请求的供应商跟随全局代理，排除不掉", async () => {
		const h = harness(() => false);

		await applyDesktopProxy(proxyConfig(), h.options);

		// 没有注入 = 落在全局代理 dispatcher 上，而不是被静默拉回直连。
		expect((await optionsSeenByProvider(model("google", "google-generative-ai")))?.fetch).toBeUndefined();
		expect(h.directFetch).not.toHaveBeenCalled();
	});

	it("上游在本机的供应商不注入传输，交给全局 dispatcher 的本机豁免", async () => {
		// CLIProxyAPI 这类本机桥接网关：这一跳不出网，注入直连或代理都是多余的。
		const h = harness();

		await applyDesktopProxy(proxyConfig(), h.options);

		const local = model("cli-proxy-api.google", "google-generative-ai", "http://127.0.0.1:49507/v1beta");
		expect((await optionsSeenByProvider(local))?.fetch).toBeUndefined();
		expect(h.directFetch).not.toHaveBeenCalled();
	});

	it("配置无效时本机上游照常工作，不被一起打死", async () => {
		const h = harness();

		await applyDesktopProxy(proxyConfig({ host: "" }), h.options);

		const local = model("qwen-local", "openai-completions", "http://192.168.50.50:8124/v1");
		expect((await optionsSeenByProvider(local))?.fetch).toBeUndefined();
	});

	it("关掉代理后还原全局 dispatcher，供应商请求回到直连", async () => {
		const h = harness();
		await applyDesktopProxy(proxyConfig(), h.options);

		const applied = await applyDesktopProxy(proxyConfig({ enabled: false }), h.options);

		expect(applied).toEqual({ mode: "direct" });
		expect(h.disposeGlobal).toHaveBeenCalledOnce();
		expect(h.disposeDirect).toHaveBeenCalledOnce();
		expect((await optionsSeenByProvider(model("anthropic")))?.fetch).toBeUndefined();
	});

	it("改代理地址会先释放上一份连接池，隧道不会继续指向旧代理", async () => {
		const h = harness();
		await applyDesktopProxy(proxyConfig(), h.options);

		await applyDesktopProxy(proxyConfig({ host: "other.example.com" }), h.options);

		expect(h.disposeGlobal).toHaveBeenCalledOnce();
		expect(h.installed).toEqual(["http://proxy.example.com:3128", "http://other.example.com:3128"]);
	});

	it("配置无效时让本该走代理的请求失败，而不是安静地直连出去", async () => {
		const h = harness();

		const applied = await applyDesktopProxy(proxyConfig({ host: "" }), h.options);

		expect(applied).toEqual({ mode: "invalid" });
		// 拒绝一切的全局 dispatcher 会把更新检查、图片加载一并打死，代价远超收益。
		expect(h.installed).toEqual([]);
		const injected = (await optionsSeenByProvider(model("anthropic")))?.fetch;
		await expect(injected?.("https://api.anthropic.com/v1/messages")).rejects.toThrow(/invalid/i);
		expect(h.env.HTTPS_PROXY).toBeUndefined();
	});

	it("配置无效时被排除的供应商照常直连，不受牵连", async () => {
		const h = harness((providerId) => (providerId === "deepseek" ? false : undefined));

		await applyDesktopProxy(proxyConfig({ host: "" }), h.options);

		expect((await optionsSeenByProvider(model("deepseek")))?.fetch).toBeUndefined();
	});
});

describe("代理环境变量", () => {
	it("启用后写入代理与环回豁免，供本地命令、Go sidecar 与 Bedrock 跟随", async () => {
		const h = harness();

		await applyDesktopProxy(proxyConfig({ username: "u", password: "p" }), h.options);

		expect(h.env.HTTPS_PROXY).toBe("http://u:p@proxy.example.com:3128");
		expect(h.env.http_proxy).toBe("http://u:p@proxy.example.com:3128");
		expect(h.env.NO_PROXY).toContain("127.0.0.1");
	});

	it("关闭后还原用户本来就导出的代理变量，而不是把它删掉", async () => {
		const h = harness();
		h.env.HTTPS_PROXY = "http://shell.example.com:8080";

		await applyDesktopProxy(proxyConfig(), h.options);
		expect(h.env.HTTPS_PROXY).toBe("http://proxy.example.com:3128");

		await applyDesktopProxy(proxyConfig({ enabled: false }), h.options);
		expect(h.env.HTTPS_PROXY).toBe("http://shell.example.com:8080");
		expect(h.env.HTTP_PROXY).toBeUndefined();
	});
});
