import { afterEach, describe, expect, it, vi } from "vitest";

const HTTP_PROXY_MODULE = "../src/utils/http-proxy.js";

/**
 * mock 工厂会被提升到文件顶部，不能闭包引用测试内的局部变量，
 * 所以用 globalThis 传递替身与调用记录。
 */
interface ProxyTestBridge {
	dispatchers: unknown[];
	agentClass: new () => unknown;
}
declare global {
	var __httpProxyTest: ProxyTestBridge | undefined;
}

vi.mock("undici", () => {
	const bridge = globalThis.__httpProxyTest;
	return {
		EnvHttpProxyAgent: bridge?.agentClass,
		setGlobalDispatcher: (dispatcher: unknown) => void bridge?.dispatchers.push(dispatcher),
	};
});

class FakeEnvHttpProxyAgent {}

afterEach(() => {
	globalThis.__httpProxyTest = undefined;
	vi.resetModules();
	vi.restoreAllMocks();
});

/** 等 http-proxy 内部那条 import().then 链跑完（动态 import 会跨多个 tick）。 */
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe("http-proxy", () => {
	it("装上 EnvHttpProxyAgent", async () => {
		globalThis.__httpProxyTest = { dispatchers: [], agentClass: FakeEnvHttpProxyAgent };

		await import(HTTP_PROXY_MODULE);
		await flushMicrotasks();

		expect(globalThis.__httpProxyTest?.dispatchers).toHaveLength(1);
		expect(globalThis.__httpProxyTest?.dispatchers[0]).toBeInstanceOf(FakeEnvHttpProxyAgent);
	});
});
