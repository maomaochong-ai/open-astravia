import { useSyncExternalStore } from "react";
import type { DesignSystem } from "./types";

/**
 * 设计体系的运行时注册表。
 *
 * 数据**只**来自远端资源仓库（缓存或网络），插件不再随包内置任何一套。所以「一套都
 * 没有」是一个真实可能的状态，UI 必须能表达它——这也是这里除了列表还带一个 status 的
 * 原因：空列表要区分「还在拉」和「拉失败了」，否则用户只会看到无解释的空白。
 *
 * 挂在 globalThis 上而不是模块级 let——Module Federation 会把同一个模块复制给不同
 * 消费方，模块级可变状态会分裂成多份（写入方和读取方各拿一个实例，表现为构建正常、
 * 刷新后失效）。可变的跨组件状态一律走 globalThis。
 */
const REGISTRY_KEY = "__vettaUiDesignSystemRegistry__";

/** loading：还没有过任何结果；ready：拿到过可用列表；failed：拉取失败且手上没有列表。 */
export type CatalogStatus = "loading" | "ready" | "failed";

export interface CatalogState {
	systems: readonly DesignSystem[];
	status: CatalogStatus;
}

interface RegistryState extends CatalogState {
	listeners: Set<() => void>;
	/** 快照对象缓存：useSyncExternalStore 要求同一状态返回同一引用，否则无限重渲染。 */
	snapshot: CatalogState;
}

function registry(): RegistryState {
	const host = globalThis as typeof globalThis & { [REGISTRY_KEY]?: RegistryState };
	let state = host[REGISTRY_KEY];
	if (!state) {
		state = {
			systems: [],
			status: "loading",
			listeners: new Set(),
			snapshot: { systems: [], status: "loading" },
		};
		host[REGISTRY_KEY] = state;
	}
	return state;
}

function publish(state: RegistryState): void {
	state.snapshot = { systems: state.systems, status: state.status };
	for (const listener of state.listeners) listener();
}

/** 当前生效的设计体系列表。 */
export function designSystems(): readonly DesignSystem[] {
	return registry().systems;
}

export function designSystemById(id: string): DesignSystem | undefined {
	return registry().systems.find((system) => system.id === id);
}

export function catalogState(): CatalogState {
	return registry().snapshot;
}

/**
 * 整体替换列表。空数组会被忽略——一份「解析出 0 条」的清单不足以推翻手上已有的内容。
 * 返回是否真的替换了。
 */
export function setDesignSystems(systems: readonly DesignSystem[]): boolean {
	if (systems.length === 0) return false;
	const state = registry();
	state.systems = systems;
	state.status = "ready";
	publish(state);
	return true;
}

/** 一轮同步彻底没拿到东西。手上已有列表时不降级——旧内容仍然可用。 */
export function markCatalogFailed(): void {
	const state = registry();
	if (state.systems.length > 0) return;
	state.status = "failed";
	publish(state);
}

/** 重新进入加载态（重试时用）。 */
export function markCatalogLoading(): void {
	const state = registry();
	if (state.systems.length > 0) return;
	state.status = "loading";
	publish(state);
}

/** 清空回初始状态（测试用）。 */
export function resetDesignSystems(): void {
	const state = registry();
	state.systems = [];
	state.status = "loading";
	publish(state);
}

export function subscribeDesignSystems(listener: () => void): () => void {
	const state = registry();
	state.listeners.add(listener);
	return () => {
		state.listeners.delete(listener);
	};
}

/** 订阅式读取：远端清单到货或失败时，用到它的 UI 会自动重渲染。 */
export function useDesignSystems(): readonly DesignSystem[] {
	return useSyncExternalStore(subscribeDesignSystems, designSystems, designSystems);
}

/** 订阅式读取列表与状态：空列表要靠 status 区分「还在拉」和「拉失败」。 */
export function useCatalogState(): CatalogState {
	return useSyncExternalStore(subscribeDesignSystems, catalogState, catalogState);
}
