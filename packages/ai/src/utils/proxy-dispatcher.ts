/**
 * 进程级代理 dispatcher 的装卸。
 *
 * 为什么需要它：`@google/genai` 的 ApiClient 直接调裸 `fetch`，没有任何注入口，
 * 每请求 dispatcher 够不着它。唯一能覆盖到的杠杆是 undici 的全局 dispatcher。
 *
 * 于是代理开启时的默认方向是反过来的：**全局默认走代理**，个别被排除的 Provider
 * 由注入的 fetch 显式带一个直连 dispatcher 把全局盖掉。可注入的 Provider 本来就
 * 经过那层 fetch，所以这个反转不需要它们各自配合。
 *
 * 注意 `EnvHttpProxyAgent`（`utils/http-proxy.ts`）只在构造时读一次环境变量，
 * 启动后再改 env 对它无效——这正是必须显式换掉全局 dispatcher 的原因。
 */

import type { FetchFunction } from "../types.js";

/** 一个自带 dispatcher 的 fetch，连同它那份连接池的释放句柄。 */
export interface ManagedFetch {
	readonly fetch: FetchFunction;
	/** 释放底层连接池。配置变更或宿主退出时调用。 */
	dispose(): Promise<void>;
}

/** undici dispatcher 是结构化鸭子类型，这里只约束到本模块真正用到的部分。 */
export interface UndiciDispatcher {
	close(): Promise<void>;
}

export interface GlobalDispatcherControl {
	readonly get: () => UndiciDispatcher;
	readonly set: (dispatcher: UndiciDispatcher) => void;
	readonly createProxyAgent: (proxyUrl: string) => UndiciDispatcher;
	readonly createDirectAgent: () => UndiciDispatcher;
}

async function loadUndiciControl(): Promise<GlobalDispatcherControl> {
	const { Agent, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } = await import("undici");
	return {
		get: () => getGlobalDispatcher() as unknown as UndiciDispatcher,
		set: (dispatcher) => setGlobalDispatcher(dispatcher as never),
		createProxyAgent: (proxyUrl) => new ProxyAgent(proxyUrl) as unknown as UndiciDispatcher,
		createDirectAgent: () => new Agent() as unknown as UndiciDispatcher,
	};
}

export interface GlobalProxyDispatcherHandle {
	/** 还原装上之前的全局 dispatcher，并关掉本次建立的代理连接池。 */
	dispose(): Promise<void>;
}

/**
 * 把全局 dispatcher 换成走代理的那个，返回还原句柄。
 *
 * 还原而不是清空：装上之前那个可能是 `EnvHttpProxyAgent`（用户在 shell 里导出
 * 过代理），直接扔掉等于把他原有的代理弄没了。
 */
export async function installGlobalProxyDispatcher(
	proxyUrl: string,
	loadControl: () => Promise<GlobalDispatcherControl> = loadUndiciControl,
): Promise<GlobalProxyDispatcherHandle> {
	const control = await loadControl();
	const previous = control.get();
	const agent = control.createProxyAgent(proxyUrl);
	control.set(agent);
	return {
		dispose: async () => {
			control.set(previous);
			await agent.close();
		},
	};
}

/**
 * 显式直连的 fetch，用来把全局代理 dispatcher 盖掉。
 *
 * 给的是被用户排除出代理的 Provider；环回豁免不在这里，那是 `createProxyFetch`
 * 的恒定行为，此处本来就不经代理。
 */
export function createDirectFetch(
	options: { readonly baseFetch?: FetchFunction; readonly loadControl?: () => Promise<GlobalDispatcherControl> } = {},
): ManagedFetch {
	const baseFetch = options.baseFetch ?? globalThis.fetch;
	const loadControl = options.loadControl ?? loadUndiciControl;

	let agent: Promise<UndiciDispatcher> | undefined;
	const getAgent = (): Promise<UndiciDispatcher> => {
		agent ??= loadControl().then((control) => control.createDirectAgent());
		return agent;
	};

	return {
		fetch: async (input, init) => {
			const direct = await getAgent();
			// `dispatcher` 不在标准 RequestInit 里，但 undici 的 fetch 认它。
			return baseFetch(input, { ...init, dispatcher: direct } as RequestInit);
		},
		dispose: async () => {
			const pending = agent;
			agent = undefined;
			if (pending) await (await pending).close();
		},
	};
}
