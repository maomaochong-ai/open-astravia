import { useEffectiveShortcut } from "@shared/hooks/useShortcuts";
import { matchesShortcut } from "@shared/lib/platform";
import { activeSessionAtom, draftPlanModeAtom, planModeStateBySessionAtom } from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface PlanModeModel {
	readonly active: boolean;
	readonly onToggle: () => void;
	/** 输入区内的键盘入口；返回 true 表示已处理。 */
	readonly handleKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * 计划模式的开关模型。已有会话时直接切换 Runtime 的权限模式；新会话页没有 Runtime，
 * 先记成草稿，发送第一条消息前再落地（见 services/plan-mode-draft）。
 */
export function usePlanModeModel(): PlanModeModel {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const runtimeId = activeSession?.runtimeId;
	const states = useAtomValue(planModeStateBySessionAtom);
	const setStates = useSetAtom(planModeStateBySessionAtom);
	const [draft, setDraft] = useAtom(draftPlanModeAtom);
	const shortcut = useEffectiveShortcut("toggle-plan-mode");
	const active = runtimeId ? states[runtimeId]?.permissionMode === "plan" : draft;

	const setActive = useCallback(
		async (next: boolean) => {
			if (!runtimeId) {
				setDraft(next);
				return;
			}
			try {
				const state = await window.vetta.session.setPermissionMode(runtimeId, next ? "plan" : "default");
				setStates((prev) => ({ ...prev, [runtimeId]: state }));
			} catch (error) {
				console.error("[PlanMode] failed to switch permission mode:", error);
				showToast({ variant: "error", message: t("planMode.switchFailed") });
			}
		},
		[runtimeId, setDraft, setStates, t],
	);

	const onToggle = useCallback(() => void setActive(!active), [active, setActive]);
	const handleKeyDown = useCallback(
		(event: KeyboardEvent): boolean => {
			if (!shortcut || !matchesShortcut(event, shortcut)) return false;
			event.preventDefault();
			onToggle();
			return true;
		},
		[onToggle, shortcut],
	);

	return useMemo(() => ({ active, onToggle, handleKeyDown }), [active, handleKeyDown, onToggle]);
}
