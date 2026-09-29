import { activeSessionAtom, goalDialogOpenAtom, goalStateBySessionAtom } from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import type { CodingAgentGoalState } from "@vetta/coding-agent/session-extensions";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface GoalModeModel {
	readonly state: CodingAgentGoalState | null;
	readonly active: boolean;
	readonly open: boolean;
	readonly busy: boolean;
	readonly setOpen: (open: boolean) => void;
	readonly onToggle: () => void;
	readonly start: (objective: string) => Promise<void>;
	readonly pause: () => Promise<void>;
	readonly resume: () => Promise<void>;
	readonly clear: () => Promise<void>;
}

export function useGoalModeModel(): GoalModeModel {
	const { t } = useTranslation("chat");
	const runtimeId = useAtomValue(activeSessionAtom)?.runtimeId;
	const states = useAtomValue(goalStateBySessionAtom);
	const setStates = useSetAtom(goalStateBySessionAtom);
	const [open, setOpen] = useAtom(goalDialogOpenAtom);
	const [busy, setBusy] = useState(false);
	const state = runtimeId ? (states[runtimeId] ?? null) : null;
	const active = state?.status === "active";

	const run = useCallback(
		async (operation: () => Promise<CodingAgentGoalState | null>) => {
			if (!runtimeId || busy) return;
			setBusy(true);
			try {
				const next = await operation();
				setStates((previous) => {
					const updated = { ...previous };
					if (next) updated[runtimeId] = next;
					else delete updated[runtimeId];
					return updated;
				});
				setOpen(false);
			} catch (error) {
				console.error("[GoalMode] goal operation failed:", error);
				showToast({ variant: "error", message: t("goalMode.operationFailed") });
			} finally {
				setBusy(false);
			}
		},
		[busy, runtimeId, setOpen, setStates, t],
	);

	const start = useCallback(
		(objective: string) => run(() => window.vetta.session.startGoal(runtimeId!, objective)),
		[run, runtimeId],
	);
	const pause = useCallback(
		() => (state ? run(() => window.vetta.session.pauseGoal(runtimeId!, state.goalId)) : Promise.resolve()),
		[run, runtimeId, state],
	);
	const resume = useCallback(
		() => (state ? run(() => window.vetta.session.resumeGoal(runtimeId!, state.goalId)) : Promise.resolve()),
		[run, runtimeId, state],
	);
	const clear = useCallback(
		() => (state ? run(() => window.vetta.session.clearGoal(runtimeId!, state.goalId)) : Promise.resolve()),
		[run, runtimeId, state],
	);
	const onToggle = useCallback(() => {
		if (active) void pause();
		else setOpen(true);
	}, [active, pause, setOpen]);

	return useMemo(
		() => ({ state, active, open, busy, setOpen, onToggle, start, pause, resume, clear }),
		[state, active, open, busy, setOpen, onToggle, start, pause, resume, clear],
	);
}
