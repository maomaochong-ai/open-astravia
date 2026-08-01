import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useCallback, useEffect, useState } from "react";
import { aheadBehind, diffStat, gitFetch, gitPull, gitPush, gitSync } from "../git/run";
import { emitRefreshSignal, onRefreshSignal } from "../git/runtime";
import { FetchIcon, PullIcon, PushIcon, SyncIcon } from "./icons";

type ActionKind = "fetch" | "pull" | "push" | "sync";

/**
 * Left-side action row in the changes toolbar: fetch / pull / push (with
 * ahead-behind counts) plus the working-tree added/deleted line totals. Reloads
 * on the shared refresh signal and after each action.
 */
export function GitActions({ root }: { root: string }): JSX.Element {
	const { t } = useTranslation();
	const [ab, setAb] = useState<{ ahead: number; behind: number } | null>(null);
	const [stat, setStat] = useState({ additions: 0, deletions: 0 });
	const [busy, setBusy] = useState<ActionKind | null>(null);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(() => {
		aheadBehind(root)
			.then(setAb)
			.catch(() => setAb(null));
		diffStat(root)
			.then(setStat)
			.catch(() => {});
	}, [root]);

	useEffect(() => {
		reload();
		return onRefreshSignal(reload);
	}, [reload]);

	const runAction = useCallback(
		(kind: ActionKind, fn: (root: string) => Promise<void>) => {
			if (busy) return;
			setBusy(kind);
			setError(null);
			fn(root)
				.then(() => {
					emitRefreshSignal();
					reload();
				})
				.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
				.finally(() => setBusy(null));
		},
		[busy, root, reload],
	);

	const spin = (kind: ActionKind): string => (busy === kind ? "animate-spin" : "");

	return (
		<div className="flex items-center gap-1.5">
			<div className="flex items-center gap-0.5">
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					title={t("action.fetch")}
					disabled={busy !== null}
					onClick={() => runAction("fetch", gitFetch)}
				>
					<FetchIcon className={`h-4 w-4 text-sky-500 ${spin("fetch")}`} />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					className="px-1.5"
					title={ab && ab.behind > 0 ? `${t("action.pull")} (${ab.behind})` : t("action.pull")}
					disabled={busy !== null}
					onClick={() => runAction("pull", gitPull)}
				>
					<PullIcon className={`h-4 w-4 text-sky-500 ${spin("pull")}`} />
					{ab && ab.behind > 0 && <span className="text-[11px] font-semibold tabular-nums leading-none text-sky-500">{ab.behind}</span>}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					className="px-1.5"
					title={ab && ab.ahead > 0 ? `${t("action.push")} (${ab.ahead})` : t("action.push")}
					disabled={busy !== null}
					onClick={() => runAction("push", gitPush)}
				>
					<PushIcon className={`h-4 w-4 text-emerald-500 ${spin("push")}`} />
					{ab && ab.ahead > 0 && <span className="text-[11px] font-semibold tabular-nums leading-none text-emerald-500">{ab.ahead}</span>}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					title={t("action.sync")}
					disabled={busy !== null}
					onClick={() => runAction("sync", gitSync)}
				>
					<SyncIcon className={`h-4 w-4 text-muted-foreground ${spin("sync")}`} />
				</Button>
			</div>

			{stat.additions > 0 && (
				<span className="rounded-md bg-emerald-500/15 px-1.5 py-1 text-[11px] font-semibold leading-none tabular-nums text-emerald-500">+{stat.additions}</span>
			)}
			{stat.deletions > 0 && (
				<span className="rounded-md bg-rose-500/15 px-1.5 py-1 text-[11px] font-semibold leading-none tabular-nums text-rose-500">−{stat.deletions}</span>
			)}
			{error && (
				<span className="cursor-default font-semibold text-rose-500" title={error}>
					!
				</span>
			)}
		</div>
	);
}
