import { describe, expect, it, vi } from "vitest";
import {
	createDirectFetch,
	type GlobalDispatcherControl,
	installGlobalProxyDispatcher,
	type UndiciDispatcher,
} from "../src/utils/proxy-dispatcher.js";

function agent(): UndiciDispatcher {
	return { dispatch: vi.fn(() => true), close: vi.fn(async () => {}) };
}

function fakeControl() {
	const inherited = agent();
	let current = inherited;
	const proxyAgents: { url: string; agent: UndiciDispatcher }[] = [];
	const directAgents: UndiciDispatcher[] = [];
	const control: GlobalDispatcherControl = {
		get: () => current,
		set: (dispatcher) => {
			current = dispatcher;
		},
		createProxyAgent: (url) => {
			const created = agent();
			proxyAgents.push({ url, agent: created });
			return created;
		},
		createDirectAgent: () => {
			const created = agent();
			directAgents.push(created);
			return created;
		},
	};
	return { control, inherited, proxyAgents, directAgents, currentOf: () => current };
}

describe("installGlobalProxyDispatcher", () => {
	it("sends remote origins through the proxy agent", async () => {
		// `@google/genai` 调裸 fetch，没有注入口，只有全局 dispatcher 覆盖得到它。
		const f = fakeControl();

		await installGlobalProxyDispatcher("http://proxy.example.com:3128", async () => f.control);
		f.currentOf().dispatch({ origin: "https://generativelanguage.googleapis.com" }, {});

		expect(f.proxyAgents.map((entry) => entry.url)).toEqual(["http://proxy.example.com:3128"]);
		expect(f.proxyAgents[0]?.agent.dispatch).toHaveBeenCalledOnce();
		expect(f.directAgents[0]?.dispatch).not.toHaveBeenCalled();
	});

	it("sends local and LAN origins direct, so a self-hosted gateway keeps working", async () => {
		// 装裸 ProxyAgent 会对 127.0.0.1 也建隧道，本机桥接网关当场连不上。
		const f = fakeControl();

		await installGlobalProxyDispatcher("http://proxy.example.com:3128", async () => f.control);
		for (const origin of ["http://127.0.0.1:49507", "http://192.168.50.50:8124", "http://gateway.local:3000"]) {
			f.currentOf().dispatch({ origin }, {});
		}

		expect(f.directAgents[0]?.dispatch).toHaveBeenCalledTimes(3);
		expect(f.proxyAgents[0]?.agent.dispatch).not.toHaveBeenCalled();
	});

	it("restores the inherited dispatcher on dispose instead of clearing it", async () => {
		// 装上之前那个可能是用户自己导出的代理，扔掉等于把他原有的代理弄没了。
		const f = fakeControl();

		const handle = await installGlobalProxyDispatcher("http://proxy.example.com:3128", async () => f.control);
		await handle.dispose();

		expect(f.currentOf()).toBe(f.inherited);
		expect(f.proxyAgents[0]?.agent.close).toHaveBeenCalledOnce();
		expect(f.directAgents[0]?.close).toHaveBeenCalledOnce();
	});
});

describe("createDirectFetch", () => {
	it("pins an explicit direct dispatcher so the global proxy is overridden", async () => {
		const f = fakeControl();
		const baseFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"));

		const direct = createDirectFetch({ baseFetch, loadControl: async () => f.control });
		await direct.fetch("https://api.deepseek.com/v1/chat/completions");

		const [, init] = baseFetch.mock.calls[0] ?? [];
		expect(init).toMatchObject({ dispatcher: f.directAgents[0] });
	});

	it("reuses one agent and closes it on dispose", async () => {
		const f = fakeControl();
		const baseFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"));

		const direct = createDirectFetch({ baseFetch, loadControl: async () => f.control });
		await direct.fetch("https://api.deepseek.com/a");
		await direct.fetch("https://api.deepseek.com/b");
		await direct.dispose();

		expect(f.directAgents).toHaveLength(1);
		expect(f.directAgents[0]?.close).toHaveBeenCalledOnce();
	});
});
