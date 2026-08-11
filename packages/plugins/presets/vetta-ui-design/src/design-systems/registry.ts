import { useSyncExternalStore } from "react";
import { BUILTIN_DESIGN_SYSTEMS } from "./builtin";
import type { DesignSystem } from "./types";

/**
 * 设计体系的运行时注册表：内置那份是初值兼兜底，远端清单拉到并校验通过后整体替换。
 *
 * 挂在 globalThis 上而不是模块级 let——Module Federation 会把同一个模块复制给不同
 * 消费方，模块级可变状态会分裂成多份（写入方和读取方各拿一个实例，表现为构建正常、
 * 刷新后失效）。可变的跨组件状态一律走 globalThis。
 */
const REGISTRY_KEY = "__vettaUiDesignSystemRegistry__";

interface RegistryState {
	systems: readonly DesignSystem[];
	listeners: Set<() => void>;
}

function registry(): RegistryState {
	const host = globalThis as typeof globalThis & { [REGISTRY_KEY]?: RegistryState };
	let state = host[REGISTRY_KEY];
	if (!state) {
		state = { systems: BUILTIN_DESIGN_SYSTEMS, listeners: new Set() };
		host[REGISTRY_KEY] = state;
	}
	return state;
}

/** 当前生效的设计体系列表（远端可用时是远端的，否则是内置的）。 */
export function designSystems(): readonly DesignSystem[] {
	return registry().systems;
}

export function designSystemById(id: string): DesignSystem | undefined {
	return registry().systems.find((system) => system.id === id);
}

/**
 * 整体替换列表。空数组会被忽略——宁可继续用上一份（内置或缓存），也不要把选择器变空。
 * 返回是否真的替换了。
 */
export function setDesignSystems(systems: readonly DesignSystem[]): boolean {
	if (systems.length === 0) return false;
	const state = registry();
	state.systems = systems;
	for (const listener of state.listeners) listener();
	return true;
}

/** 恢复到打包内置的那份（测试用；生产路径只前进不回退）。 */
export function resetDesignSystems(): void {
	const state = registry();
	state.systems = BUILTIN_DESIGN_SYSTEMS;
	for (const listener of state.listeners) listener();
}

export function subscribeDesignSystems(listener: () => void): () => void {
	const state = registry();
	state.listeners.add(listener);
	return () => {
		state.listeners.delete(listener);
	};
}

/** 订阅式读取：远端清单到货后，用到它的 UI 会自动重渲染。 */
export function useDesignSystems(): readonly DesignSystem[] {
	return useSyncExternalStore(subscribeDesignSystems, designSystems, designSystems);
}
