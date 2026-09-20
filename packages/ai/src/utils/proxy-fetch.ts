/**
 * 把一份代理配置包成可注入的 `fetch`。
 *
 * 走的是 undici 的「每请求 dispatcher」：`fetch(input, { dispatcher })`。这样同一
 * 个进程里不同 Provider 可以分别直连或经代理，而不必像 `setGlobalDispatcher` 那样
 * 一刀切——后者正是 `utils/http-proxy.ts` 那套环境变量代理的形态，它管不了
 * 「这个供应商走代理、那个直连」。
 */

import type { FetchFunction } from "../types.js";
import {
	type ProxyConfig,
	type ProxyConfigErrorReason,
	type ProxyResolution,
	resolveProxyConfig,
	shouldBypassProxy,
} from "./proxy-config.js";

/** 代理配置无效时抛出。绝不静默降级为直连：用户以为被代理保护着，实际在裸奔。 */
export class ProxyConfigurationError extends Error {
	readonly reason: ProxyConfigErrorReason;

	constructor(reason: ProxyConfigErrorReason) {
		super(`Proxy configuration is invalid: ${reason}`);
		this.name = "ProxyConfigurationError";
		this.reason = reason;
	}
}

/** undici 的 dispatcher 是结构化鸭子类型，这里只约束到本模块真正用到的部分。 */
interface ProxyDispatcher {
	close(): Promise<void>;
}

type ProxyDispatcherLoader = (proxyUrl: string) => Promise<ProxyDispatcher>;

const defaultLoader: ProxyDispatcherLoader = async (proxyUrl) => {
	const { ProxyAgent } = await import("undici");
	return new ProxyAgent(proxyUrl) as unknown as ProxyDispatcher;
};

type FetchInput = Parameters<FetchFunction>[0];

function targetUrlOf(input: FetchInput): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

export interface CreateProxyFetchOptions {
	/** 底层 fetch，默认全局 fetch（Node/Electron 主进程即 undici 的 fetch）。 */
	readonly baseFetch?: FetchFunction;
	/** dispatcher 工厂，测试用来避开真实 undici。 */
	readonly loadDispatcher?: ProxyDispatcherLoader;
}

export interface ProxyFetch {
	readonly fetch: FetchFunction;
	/** 释放底层连接池。配置变更或宿主退出时调用。 */
	dispose(): Promise<void>;
}

/**
 * 按配置构造代理 fetch。
 *
 * - 配置为「直连」时返回 `undefined`，调用方据此沿用原有 fetch，不额外包一层。
 * - 配置无效时仍然返回一个 fetch，但它每次调用都抛 {@link ProxyConfigurationError}。
 *   错误留到请求时抛，才能带着具体哪个请求失败的上下文送到用户面前。
 */
export function createProxyFetch(
	config: ProxyConfig | undefined,
	options: CreateProxyFetchOptions = {},
): ProxyFetch | undefined {
	const resolution = resolveProxyConfig(config);
	if (resolution.mode === "direct") return undefined;
	return createProxyFetchFromResolution(resolution, options);
}

export function createProxyFetchFromResolution(
	resolution: Exclude<ProxyResolution, { mode: "direct" }>,
	options: CreateProxyFetchOptions = {},
): ProxyFetch {
	const baseFetch = options.baseFetch ?? globalThis.fetch;
	const loadDispatcher = options.loadDispatcher ?? defaultLoader;

	if (resolution.mode === "invalid") {
		return {
			fetch: () => Promise.reject(new ProxyConfigurationError(resolution.reason)),
			dispose: () => Promise.resolve(),
		};
	}

	// 连接池按配置复用一份：每个请求新建 ProxyAgent 会让长会话反复重建 TLS 隧道。
	let dispatcher: Promise<ProxyDispatcher> | undefined;
	const getDispatcher = (): Promise<ProxyDispatcher> => {
		dispatcher ??= loadDispatcher(resolution.url);
		return dispatcher;
	};

	return {
		fetch: async (input, init) => {
			if (shouldBypassProxy(targetUrlOf(input))) return baseFetch(input, init);
			const agent = await getDispatcher();
			// `dispatcher` 不在标准 RequestInit 里，但 undici 的 fetch 认它。
			return baseFetch(input, { ...init, dispatcher: agent } as RequestInit);
		},
		dispose: async () => {
			const pending = dispatcher;
			dispatcher = undefined;
			if (pending) await (await pending).close();
		},
	};
}
