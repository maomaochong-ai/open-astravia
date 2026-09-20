import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta-org/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	aheadBehind,
	currentBranch,
	defaultRemote,
	diffStat,
	gitFetch,
	gitPublishBranch,
	gitPull,
	gitPush,
	gitSync,
	hasUpstream,
} from "../git/run";
import { emitRefreshSignal, onRefreshSignal } from "../git/runtime";
import { ConfirmDialog } from "./ConfirmDialog";
import { FetchIcon, PullIcon, PushIcon, SyncIcon } from "./icons";

type ActionKind = "fetch" | "pull" | "push" | "sync";

/** A branch with no upstream, pending the user's go-ahead to publish it. */
interface PendingPublish {
	branch: string;
	remote: string;
}

/**
 * Left-side action row in the changes toolbar: fetch / pull / push (with
 * ahead-behind counts) plus the working-tree added/deleted line totals. Reloads
 * on the shared refresh signal and after each action.
 */
export function GitActions({ root }: { root: string }): JSX.Element {
	const { t } = useTranslation();
	const [ab, setAb] = useState<{ ahead: number; behind: number } | null>(null);
	const [stat, setStat] = useState({ additions: 0, deletions: 0, untrackedTruncated: false });
	const [busy, setBusy] = useState<ActionKind | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pendingPublish, setPendingPublish] = useState<PendingPublish | null>(null);
	// Reloads overlap (refresh signal + post-action), and they finish out of order;
	// only the newest one may write state.
	const reloadIdRef = useRef(0);

	const reload = useCallback(() => {
		const id = ++reloadIdRef.current;
		aheadBehind(root)
			.then((value) => {
				if (id === reloadIdRef.current) setAb(value);
			})
			.catch(() => {
				if (id === reloadIdRef.current) setAb(null);
			});
		diffStat(root)
			.then((value) => {
				if (id === reloadIdRef.current) setStat(value);
			})
			.catch(() => {});
	}, [root]);

	useEffect(() => {
		reload();
		return onRefreshSignal(reload);
	}, [reload]);

	/**
	 * Run one toolbar action with the shared busy/error handling. `fn` may return
	 * "deferred" to hand control to a dialog instead of finishing the action.
	 */
	const runAction = useCallback(
		(kind: ActionKind, fn: () => Promise<"done" | "deferred">) => {
			if (busy) return;
			setBusy(kind);
			setError(null);
			fn()
				.then((outcome) => {
					if (outcome !== "done") return;
					emitRefreshSignal();
					reload();
				})
				.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
				.finally(() => setBusy(null));
		},
		[busy, reload],
	);

	/**
	 * Pushing an unpublished branch: bare `git push` fails outright ("has no
	 * upstream branch"), which every freshly created branch would hit. Resolve the
	 * branch + remote and ask, rather than silently writing tracking config.
	 */
	const preflightPush = useCallback(async (): Promise<"done" | "deferred"> => {
		if (await hasUpstream(root)) return "done";
		const [branch, remote] = await Promise.all([currentBranch(root), defaultRemote(root)]);
		if (!branch) throw new Error(t("error.detachedHead"));
		if (!remote) throw new Error(t("error.noRemote"));
		setPendingPublish({ branch, remote });
		return "deferred";
	}, [root, t]);

	const handlePush = useCallback(() => {
		runAction("push", async () => {
			const outcome = await preflightPush();
			if (outcome !== "done") return outcome;
			await gitPush(root);
			return "done";
		});
	}, [runAction, preflightPush, root]);

	// Syncing an unpublished branch has nothing to pull; publishing IS the sync.
	const handleSync = useCallback(() => {
		runAction("sync", async () => {
			const outcome = await preflightPush();
			if (outcome !== "done") return outcome;
			await gitSync(root);
			return "done";
		});
	}, [runAction, preflightPush, root]);

	const confirmPublish = useCallback(() => {
		const target = pendingPublish;
		if (!target) return;
		setPendingPublish(null);
		runAction("push", async () => {
			await gitPublishBranch(root, target.remote, target.branch);
			return "done";
		});
	}, [pendingPublish, runAction, root]);

	const spin = (kind: ActionKind): string => (busy === kind ? "animate-spin" : "");

	return (
		<div className="flex items-center gap-2">
			<div className="flex items-center gap-0.5">
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					title={t("action.fetch")}
					disabled={busy !== null}
					onClick={() => runAction("fetch", async () => (await gitFetch(root), "done"))}
				>
					<FetchIcon className={`h-4 w-4 text-muted-foreground ${spin("fetch")}`} />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					className="px-1.5"
					title={ab && ab.behind > 0 ? `${t("action.pull")} (${ab.behind})` : t("action.pull")}
					disabled={busy !== null}
					onClick={() => runAction("pull", async () => (await gitPull(root), "done"))}
				>
					<PullIcon className={`h-4 w-4 ${ab && ab.behind > 0 ? "text-sky-500" : "text-muted-foreground"} ${spin("pull")}`} />
					{ab && ab.behind > 0 && <span className="text-[11px] font-semibold tabular-nums leading-none text-sky-500">{ab.behind}</span>}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					className="px-1.5"
					title={ab && ab.ahead > 0 ? `${t("action.push")} (${ab.ahead})` : t("action.push")}
					disabled={busy !== null}
					onClick={handlePush}
				>
					<PushIcon className={`h-4 w-4 ${ab && ab.ahead > 0 ? "text-emerald-500" : "text-muted-foreground"} ${spin("push")}`} />
					{ab && ab.ahead > 0 && <span className="text-[11px] font-semibold tabular-nums leading-none text-emerald-500">{ab.ahead}</span>}
				</Button>
				<Button type="button" variant="ghost" size="icon-xs" title={t("action.sync")} disabled={busy !== null} onClick={handleSync}>
					<SyncIcon className={`h-4 w-4 text-muted-foreground ${spin("sync")}`} />
				</Button>
			</div>

			{stat.additions > 0 && (
				<span
					className="text-[11px] font-medium leading-none tabular-nums text-emerald-500/90"
					title={stat.untrackedTruncated ? t("stat.untrackedTruncated") : undefined}
				>
					+{stat.additions}
					{stat.untrackedTruncated && "+"}
				</span>
			)}
			{stat.deletions > 0 && (
				<span className="text-[11px] font-medium leading-none tabular-nums text-rose-500/90">−{stat.deletions}</span>
			)}
			{error && (
				<span className="cursor-default font-semibold text-rose-500" title={error}>
					!
				</span>
			)}

			<ConfirmDialog
				open={pendingPublish !== null}
				title={t("publish.title")}
				description={
					pendingPublish
						? t("publish.description", { branch: pendingPublish.branch, remote: pendingPublish.remote })
						: undefined
				}
				confirmLabel={t("publish.confirm")}
				onConfirm={confirmPublish}
				onCancel={() => setPendingPublish(null)}
			/>
		</div>
	);
}
