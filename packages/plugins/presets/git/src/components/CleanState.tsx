import type { PluginTranslate } from "@vetta-org/plugin-sdk";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta-org/ui";
import { useCallback, useEffect, useState } from "react";
import { graphLog } from "../git/log";
import { parseLog } from "../git/parseLog";
import { aheadBehind, gitPull, gitPush, hasUpstream } from "../git/run";
import { emitRefreshSignal, notifyError, onRefreshSignal } from "../git/runtime";
import type { CommitNode } from "../git/types";
import { CheckIcon, PullIcon, PushIcon } from "./icons";

/** Commits listed under the sync line — enough to recognise recent work, not a log. */
const RECENT_LIMIT = 5;

/** Coarse relative time; exact timestamps live in the commit detail pane. */
function relativeTime(seconds: number, t: PluginTranslate): string {
	const diff = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
	if (diff < 60) return t("time.justNow");
	if (diff < 3600) return t("time.minutes", { count: Math.floor(diff / 60) });
	if (diff < 86_400) return t("time.hours", { count: Math.floor(diff / 3600) });
	return t("time.days", { count: Math.floor(diff / 86_400) });
}

type Sync = { kind: "ahead" | "behind"; count: number } | { kind: "synced" } | { kind: "unpublished" } | null;

/**
 * What the panel shows when the working tree is clean.
 *
 * A clean tree leaves exactly two open questions — "did I forget to push?" and
 * "what just got committed?" — so the empty state answers both instead of
 * stating the obvious ("no changes") in the middle of an empty panel.
 */
export function CleanState({ root, onOpenGraph }: { root: string; onOpenGraph: () => void }): JSX.Element {
	const { t } = useTranslation();
	const [sync, setSync] = useState<Sync>(null);
	const [commits, setCommits] = useState<CommitNode[]>([]);
	const [busy, setBusy] = useState(false);

	const load = useCallback(() => {
		void (async () => {
			try {
				if (!(await hasUpstream(root))) {
					setSync({ kind: "unpublished" });
				} else {
					const ab = await aheadBehind(root);
					if (!ab) setSync(null);
					else if (ab.ahead > 0) setSync({ kind: "ahead", count: ab.ahead });
					else if (ab.behind > 0) setSync({ kind: "behind", count: ab.behind });
					else setSync({ kind: "synced" });
				}
			} catch {
				setSync(null);
			}
			try {
				setCommits(parseLog(await graphLog(root, { scope: "local", branch: null }, RECENT_LIMIT, 0)));
			} catch {
				setCommits([]);
			}
		})();
	}, [root]);

	useEffect(() => {
		load();
		return onRefreshSignal(load);
	}, [load]);

	const run = useCallback((task: () => Promise<void>) => {
		setBusy(true);
		task()
			.then(() => emitRefreshSignal())
			.catch((err: unknown) => notifyError(String(err instanceof Error ? err.message : err), err))
			.finally(() => setBusy(false));
	}, []);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
			<div className="flex items-center gap-2 text-[12px]">
				{sync?.kind === "ahead" && (
					<>
						<PushIcon className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
						<span className="min-w-0 flex-1 truncate text-foreground">{t("clean.ahead", { count: sync.count })}</span>
						<Button type="button" size="xs" variant="secondary" disabled={busy} onClick={() => run(() => gitPush(root))}>
							{t("action.push")}
						</Button>
					</>
				)}
				{sync?.kind === "behind" && (
					<>
						<PullIcon className="h-3.5 w-3.5 shrink-0 text-sky-500" />
						<span className="min-w-0 flex-1 truncate text-foreground">{t("clean.behind", { count: sync.count })}</span>
						<Button type="button" size="xs" variant="secondary" disabled={busy} onClick={() => run(() => gitPull(root))}>
							{t("action.pull")}
						</Button>
					</>
				)}
				{sync?.kind === "synced" && (
					<>
						<CheckIcon className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
						<span className="truncate text-muted-foreground">{t("clean.synced")}</span>
					</>
				)}
				{sync?.kind === "unpublished" && <span className="truncate text-muted-foreground">{t("clean.unpublished")}</span>}
				{sync === null && <span className="truncate text-muted-foreground">{t("state.clean")}</span>}
			</div>

			{commits.length > 0 && (
				<div className="flex min-w-0 flex-col">
					<div className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">{t("clean.recent")}</div>
					{commits.map((commit) => (
						<button
							key={commit.hash}
							type="button"
							onClick={onOpenGraph}
							title={t("clean.openGraph")}
							className="flex min-w-0 items-baseline gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent/40"
						>
							<span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{commit.subject}</span>
							<span className="shrink-0 text-[11px] text-muted-foreground/70">{relativeTime(commit.timestamp, t)}</span>
							<span className="git-mono shrink-0 text-[11px] text-muted-foreground/50">{commit.hash.slice(0, 7)}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
