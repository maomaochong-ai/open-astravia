/**
 * 宿主级的 Provider 传输注入点。
 *
 * 模型请求的调用点散落在 compaction、记忆抽取、会话辅助、Agent Loop 等处，挨个
 * 往 `options.fetch` 里塞传输层必然漏。这里让宿主注册一次解析器，由 `stream.ts`
 * 的四个入口统一兜住：调用方显式传的 `fetch` 永远优先，解析器只填空缺。
 */

import type { Api, FetchFunction, Model, StreamOptions } from "./types.js";

/**
 * 这些 API 由厂商 SDK 自己发请求，SDK 没有暴露 fetch 注入口，注入的传输层对它们
 * 不生效——它们只能跟随进程级 dispatcher / 代理环境变量。
 *
 * 宿主必须据此告知用户，而不是让开关看着生效、实际请求裸奔出去。
 */
export const APIS_WITHOUT_FETCH_INJECTION: readonly Api[] = [
	"bedrock-converse-stream",
	"google-generative-ai",
	"google-vertex",
];

export function supportsProviderFetchInjection(api: Api): boolean {
	return !APIS_WITHOUT_FETCH_INJECTION.includes(api);
}

/** 返回 `undefined` 表示该 Model 沿用默认传输（直连 / 全局 dispatcher）。 */
export type ProviderFetchResolver = (model: Model<Api>) => FetchFunction | undefined;

let providerFetchResolver: ProviderFetchResolver | undefined;

/** 注册解析器；传 `undefined` 清除。宿主应在启动时和配置变更后各调一次。 */
export function setProviderFetchResolver(resolver: ProviderFetchResolver | undefined): void {
	providerFetchResolver = resolver;
}

export function resolveProviderFetch(model: Model<Api>): FetchFunction | undefined {
	return providerFetchResolver?.(model);
}

/**
 * 补齐 options 上的 `fetch`。没有解析器、解析器不接管、或调用方已显式指定时，
 * 原样返回入参（含 `undefined`），避免凭空造出一个 options 对象改变既有行为。
 */
export function withProviderFetch<TOptions extends StreamOptions>(
	model: Model<Api>,
	options: TOptions | undefined,
): TOptions | undefined {
	if (options?.fetch) return options;
	const fetch = resolveProviderFetch(model);
	if (!fetch) return options;
	return { ...(options ?? ({} as TOptions)), fetch };
}
