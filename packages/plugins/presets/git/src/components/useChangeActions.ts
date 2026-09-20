import { useCallback, useState } from "react";
import { appendToGitignore } from "../git/ignore";
import { discardPaths, resolveWithSide, stageAll, stagePaths, unstageAll, unstagePaths } from "../git/run";
import { emitRefreshSignal, getOfficialApi, notifyError } from "../git/runtime";
import type { StatusGroups } from "../git/types";
import type { ChangeMenuHandlers, ChangeMenuTarget } from "./ChangeMenu";
import { useGitSettings } from "./useGitSettings";

/** Paths queued for a destructive discard, awaiting confirmation. */
export interface PendingDiscard {
	tracked: string[];
	untracked: string[];
}

export interface ChangeActions {
	handlers: ChangeMenuHandlers;
	stageAllFiles: () => void;
	unstageAllFiles: () => void;
	busy: boolean;
	pendingDiscard: PendingDiscard | null;
	confirmDiscard: () => void;
	cancelDiscard: () => void;
}

/**
 * File-level git actions for the change list, plus the state their surfaces
 * need (busy, last error, the discard confirmation).
 *
 * Everything routes through the shared write queue in `run.ts`, so a burst of
 * clicks cannot collide on `.git/index.lock`, and every success emits one
 * refresh signal instead of each caller reloading by itself.
 */
export function useChangeActions(root: string, groups: StatusGroups): ChangeActions {
	const settings = useGitSettings();
	const [busy, setBusy] = useState(false);
	const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null);

	const run = useCallback((task: () => Promise<void>) => {
		setBusy(true);
		task()
			.then(() => emitRefreshSignal())
			.catch((err: unknown) => notifyError(String(err instanceof Error ? err.message : err), err))
			.finally(() => setBusy(false));
	}, []);

	/** Split a discard target: untracked files have no stored content to restore. */
	const splitTracked = useCallback(
		(paths: readonly string[]): PendingDiscard => {
			const untrackedSet = new Set(groups.unstaged.filter((entry) => entry.code === "U").map((entry) => entry.path));
			return {
				tracked: paths.filter((path) => !untrackedSet.has(path)),
				untracked: paths.filter((path) => untrackedSet.has(path)),
			};
		},
		[groups],
	);

	const handlers: ChangeMenuHandlers = {
		onStage: (target: ChangeMenuTarget) => run(() => stagePaths(root, target.paths)),
		onUnstage: (target) => run(() => unstagePaths(root, target.paths)),
		onDiscard: (target) => {
			const split = splitTracked(target.paths);
			// Destructive: normally only records the intent and lets the dialog decide.
			// The confirmation is opt-out in settings, for users who want it out of the way.
			if (settings.confirmDiscard) setPendingDiscard(split);
			else run(() => discardPaths(root, split.tracked, split.untracked));
		},
		onIgnore: (target) => run(() => appendToGitignore(root, target.paths)),
		onResolve: (target, side) =>
			run(() => (side === "staged" ? stagePaths(root, target.paths) : resolveWithSide(root, side, target.paths))),
		onCopyPath: (target, absolute) => {
			const text = target.paths.map((path) => (absolute ? `${root}/${path}` : path)).join("\n");
			void navigator.clipboard?.writeText(text).catch((err: unknown) => notifyError("clipboard unavailable", err));
		},
		onRevealInFolder: (target) => {
			const path = target.paths[0];
			if (!path) return;
			void getOfficialApi()
				.shell.showItemInFolder(`${root}/${path}`)
				.catch((err: unknown) => notifyError(String(err instanceof Error ? err.message : err), err));
		},
	};

	return {
		handlers,
		stageAllFiles: () => run(() => stageAll(root)),
		unstageAllFiles: () => run(() => unstageAll(root)),
		busy,
		pendingDiscard,
		confirmDiscard: () => {
			const target = pendingDiscard;
			if (!target) return;
			setPendingDiscard(null);
			run(() => discardPaths(root, target.tracked, target.untracked));
		},
		cancelDiscard: () => setPendingDiscard(null),
	};
}
