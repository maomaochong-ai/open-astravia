import { useSyncExternalStore } from "react";
import type { AgentModeOption } from "../../../preload/api-types/session";

/**
 * 工作模式注册表的 renderer 侧只读缓存（ADR-0071）。
 *
 * 注册表在 coding-agent 构建期内联、应用生命周期内不变，故只经 IPC 拉取一次、
 * 全局共享；消费方（如会话流的叙事渲染）经 useAgentModeNarration 查表，
 * 不再硬编码 mode id 判断——新增模式对渲染层零改动。
 */
let cached: readonly AgentModeOption[] | undefined;
let inflight: Promise<void> | undefined;
const listeners = new Set<() => void>();

function ensureFetched(): void {
	if (cached || inflight) return;
	inflight = window.vetta.session
		.getAgentModes()
		.then((modes) => {
			cached = modes;
			for (const listener of listeners) listener();
		})
		.catch(() => {
			// 拉取失败保持未加载态：消费方使用回退值，下一个订阅者会重试。
			inflight = undefined;
		});
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	ensureFetched();
	return () => listeners.delete(listener);
}

function readSnapshot(): readonly AgentModeOption[] | undefined {
	return cached;
}

/**
 * 该模式的叙事渲染方式。未加载 / 未指定模式 / 未知模式一律回退 "staged"——
 * 与历史会话缺模式记录时按 work 恢复（LEGACY_SESSION_AGENT_MODE）的口径一致。
 */
export function useAgentModeNarration(modeId: string | null): "staged" | "inline" {
	const modes = useSyncExternalStore(subscribe, readSnapshot);
	if (!modeId) return "staged";
	return modes?.find((mode) => mode.id === modeId)?.narration ?? "staged";
}

/** 仅测试用：清空模块级缓存，避免用例间的注册表粘连。 */
export function __resetAgentModeRegistryForTests(): void {
	cached = undefined;
	inflight = undefined;
	listeners.clear();
}
