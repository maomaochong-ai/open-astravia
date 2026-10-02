import {
	activeInputDraftKeyAtom,
	activeSessionAtom,
	goalStateBySessionAtom,
	inputValueAtom,
	pushSessionInputHistory,
	recordSentInputAndClearDraft,
} from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import type { CodingAgentGoalState } from "@vetta/coding-agent/session-extensions";
import { getDefaultStore, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StartNewSessionGoal } from "../services/goal-mode-entry";

export interface GoalModeModel {
	readonly state: CodingAgentGoalState | null;
	/** 主输入框的下一次发送会创建目标，而不是发送普通消息。 */
	readonly composing: boolean;
	/** 当前是否允许创建新目标。未结束的目标存在时只能先管理该目标。 */
	readonly canCompose: boolean;
	readonly busy: boolean;
	readonly onToggleCompose: () => void;
	/** 读取主输入框的即时快照并提交；成功时才消费该份草稿。 */
	readonly submitDraft: (overrideText?: string) => Promise<boolean>;
	readonly pause: () => Promise<boolean>;
	readonly resume: () => Promise<boolean>;
	readonly clear: () => Promise<boolean>;
}

export function useGoalModeModel(startNewSessionGoal?: StartNewSessionGoal): GoalModeModel {
	const { t } = useTranslation("chat");
	const store = useStore();
	const runtimeId = useAtomValue(activeSessionAtom)?.runtimeId;
	const states = useAtomValue(goalStateBySessionAtom);
	const setStates = useSetAtom(goalStateBySessionAtom);
	const [composeDraft, setComposeDraft] = useState(false);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const state = runtimeId ? (states[runtimeId] ?? null) : null;
	const canCompose = !state || state.status === "complete";
	const composing = canCompose && composeDraft;

	const run = useCallback(
		async (operation: () => Promise<CodingAgentGoalState | null>): Promise<boolean> => {
			if (!runtimeId || busyRef.current) return false;
			busyRef.current = true;
			setBusy(true);
			const updates = trackGoalUpdates(store);
			try {
				const next = await operation();
				setStates((previous) => {
					if (updates.changed(runtimeId)) return previous;
					const updated = { ...previous };
					if (next) updated[runtimeId] = next;
					else delete updated[runtimeId];
					return updated;
				});
				return true;
			} catch (error) {
				console.error("[GoalMode] goal operation failed:", error);
				showToast({ variant: "error", message: t("goalMode.operationFailed") });
				return false;
			} finally {
				updates.dispose();
				busyRef.current = false;
				setBusy(false);
			}
		},
		[runtimeId, setStates, store, t],
	);

	const start = useCallback(
		async (objective: string): Promise<boolean> => {
			if (busyRef.current) return false;
			if (runtimeId) {
				return run(() => window.vetta.session.startGoal(runtimeId, objective));
			}
			if (!startNewSessionGoal) return false;
			busyRef.current = true;
			setBusy(true);
			const updates = trackGoalUpdates(store);
			try {
				const started = await startNewSessionGoal(objective);
				if (!started) return false;
				setStates((previous) =>
					updates.changed(started.sessionId) ? previous : { ...previous, [started.sessionId]: started.state },
				);
				return true;
			} catch (error) {
				console.error("[GoalMode] new-session goal start failed:", error);
				showToast({ variant: "error", message: t("goalMode.operationFailed") });
				return false;
			} finally {
				updates.dispose();
				busyRef.current = false;
				setBusy(false);
			}
		},
		[run, runtimeId, setStates, startNewSessionGoal, store, t],
	);
	const submitDraft = useCallback(
		async (overrideText?: string): Promise<boolean> => {
			if (!composing || busyRef.current) return false;
			const store = getDefaultStore();
			const rawDraft = store.get(inputValueAtom);
			const hasOverride = typeof overrideText === "string" && overrideText.trim().length > 0;
			const objective = (hasOverride ? overrideText : rawDraft).trim();
			if (!objective) return false;

			const started = await start(objective);
			if (!started) return false;
			setComposeDraft(false);
			if (!hasOverride) {
				if (store.get(inputValueAtom) === rawDraft) recordSentInputAndClearDraft(rawDraft);
				else pushSessionInputHistory(store.get(activeInputDraftKeyAtom), rawDraft);
			}
			return true;
		},
		[composing, start],
	);
	const pause = useCallback(
		() => (state ? run(() => window.vetta.session.pauseGoal(runtimeId!, state.goalId)) : Promise.resolve(false)),
		[run, runtimeId, state],
	);
	const resume = useCallback(
		() => (state ? run(() => window.vetta.session.resumeGoal(runtimeId!, state.goalId)) : Promise.resolve(false)),
		[run, runtimeId, state],
	);
	const clear = useCallback(
		() => (state ? run(() => window.vetta.session.clearGoal(runtimeId!, state.goalId)) : Promise.resolve(false)),
		[run, runtimeId, state],
	);
	const onToggleCompose = useCallback(() => {
		if (!canCompose || busyRef.current) return;
		setComposeDraft((previous) => !previous);
	}, [canCompose]);

	return useMemo(
		() => ({ state, composing, canCompose, busy, onToggleCompose, submitDraft, pause, resume, clear }),
		[state, composing, canCompose, busy, onToggleCompose, submitDraft, pause, resume, clear],
	);
}

function trackGoalUpdates(store: ReturnType<typeof useStore>) {
	let previous = store.get(goalStateBySessionAtom);
	const changedSessions = new Set<string>();
	// Command replies can contain the pre-execution snapshot. Observe until the
	// reply settles, including clears and navigation that unmounts the caller.
	const unsubscribe = store.sub(goalStateBySessionAtom, () => {
		const next = store.get(goalStateBySessionAtom);
		for (const sessionId of new Set([...Object.keys(previous), ...Object.keys(next)])) {
			if (previous[sessionId] !== next[sessionId]) changedSessions.add(sessionId);
		}
		previous = next;
	});
	return { changed: (sessionId: string) => changedSessions.has(sessionId), dispose: unsubscribe };
}
