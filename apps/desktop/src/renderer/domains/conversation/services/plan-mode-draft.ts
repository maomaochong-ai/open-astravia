import { draftPlanModeAtom, planModeStateBySessionAtom } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";

/**
 * 把新会话页上选好的「计划模式」落到刚创建的会话上，必须在第一条消息发出之前完成：
 * 闸门按 Turn 准入时的模式生效，晚一步这一轮就会带着完整工具面开跑。
 *
 * 落不上（例如该场景不支持计划模式）时抛错并保留草稿，由调用方中止发送——
 * 用户明确要求了「先别动手」，静默降级成直接执行是最糟的结果。
 */
export async function applyDraftPlanMode(runtimeId: string): Promise<void> {
	const store = getDefaultStore();
	if (!store.get(draftPlanModeAtom)) return;
	const state = await window.vetta.session.setPermissionMode(runtimeId, "plan");
	store.set(planModeStateBySessionAtom, (prev) => ({ ...prev, [runtimeId]: state }));
	store.set(draftPlanModeAtom, false);
}
