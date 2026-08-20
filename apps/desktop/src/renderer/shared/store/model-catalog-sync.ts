/**
 * 模型目录（本地 models.json + 远程 provider catalog）的重新校验策略。
 *
 * 纯逻辑、无 React / 无 IPC 依赖：调用方注入加载与写入函数，这里只负责
 * 「什么时候该重新拉取」——TTL 判定、并发去重、失败冷却、手动失效。
 * 抽出来是因为这套时序（stale-while-revalidate）是本次修复的核心风险点，
 * 挂在组件树上无法稳定测试。
 */

/** 目录的两个来源：本地 models.json 与服务端下发的远程 catalog。 */
export type ModelCatalogSource = "local" | "remote";

export const MODEL_CATALOG_SOURCES: readonly ModelCatalogSource[] = ["local", "remote"];

export interface ModelCatalogSyncDeps<TLocal, TRemote> {
	now: () => number;
	/** 数据在多久内视为新鲜，期间的非 force 重新校验直接跳过 */
	ttlMs?: number;
	/** 拉取失败后的最短重试间隔，避免离线时每次 focus 都打一次 */
	errorCooldownMs?: number;
	loadLocal: () => Promise<TLocal>;
	applyLocal: (value: TLocal) => void;
	/** 返回 null 表示当前不该拉远程（未登录）：不写入、也不刷新新鲜度 */
	loadRemote: () => Promise<TRemote | null>;
	applyRemote: (value: TRemote) => void;
	onError?: (source: ModelCatalogSource, error: unknown) => void;
}

export interface RevalidateOptions {
	/** 忽略 TTL 强制拉取（登录、设置页保存后等确定已变更的时机） */
	force?: boolean;
	/** 只校验部分来源，默认两者都校验 */
	sources?: readonly ModelCatalogSource[];
}

export interface ModelCatalogSync {
	revalidate: (options?: RevalidateOptions) => Promise<void>;
	/** 标记来源已过期：下一次 revalidate 必定真正拉取 */
	invalidate: (source?: ModelCatalogSource) => void;
	/** 清空全部新鲜度记录（登出） */
	reset: () => void;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_ERROR_COOLDOWN_MS = 10_000;

interface SourceState {
	/** 上次成功拉取的时刻，null 表示从未成功 */
	freshAt: number | null;
	/** 上次失败的时刻，用于冷却 */
	failedAt: number | null;
	inFlight: Promise<void> | null;
}

function createSourceState(): SourceState {
	return { freshAt: null, failedAt: null, inFlight: null };
}

export function createModelCatalogSync<TLocal, TRemote>(deps: ModelCatalogSyncDeps<TLocal, TRemote>): ModelCatalogSync {
	const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
	const errorCooldownMs = deps.errorCooldownMs ?? DEFAULT_ERROR_COOLDOWN_MS;
	const states: Record<ModelCatalogSource, SourceState> = {
		local: createSourceState(),
		remote: createSourceState(),
	};

	async function pull(source: ModelCatalogSource): Promise<void> {
		if (source === "local") {
			deps.applyLocal(await deps.loadLocal());
			return;
		}
		const providers = await deps.loadRemote();
		// null = 未登录：保持现状，由调用方（登出流程）负责清空。
		if (providers === null) return;
		deps.applyRemote(providers);
	}

	function shouldSkip(state: SourceState, force: boolean, now: number): boolean {
		if (force) return false;
		if (state.freshAt !== null && now - state.freshAt < ttlMs) return true;
		if (state.failedAt !== null && now - state.failedAt < errorCooldownMs) return true;
		return false;
	}

	function revalidateSource(source: ModelCatalogSource, force: boolean): Promise<void> {
		const state = states[source];
		// 并发去重：同一来源同时只有一个请求在飞，force 也复用它——
		// 正在飞的这一次拿到的就是最新数据。
		if (state.inFlight) return state.inFlight;
		if (shouldSkip(state, force, deps.now())) return Promise.resolve();

		const task = pull(source)
			.then(() => {
				state.freshAt = deps.now();
				state.failedAt = null;
			})
			.catch((error: unknown) => {
				// 失败不刷新 freshAt：旧数据继续展示，冷却结束后再试。
				state.failedAt = deps.now();
				deps.onError?.(source, error);
			})
			.finally(() => {
				state.inFlight = null;
			});
		state.inFlight = task;
		return task;
	}

	return {
		revalidate: async (options) => {
			const sources = options?.sources ?? MODEL_CATALOG_SOURCES;
			await Promise.all(sources.map((source) => revalidateSource(source, options?.force ?? false)));
		},
		invalidate: (source) => {
			for (const key of source ? [source] : MODEL_CATALOG_SOURCES) {
				states[key].freshAt = null;
				states[key].failedAt = null;
			}
		},
		reset: () => {
			for (const key of MODEL_CATALOG_SOURCES) {
				states[key] = createSourceState();
			}
		},
	};
}
