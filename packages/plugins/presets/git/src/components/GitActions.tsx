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
import { emitRefreshSignal, notifyError, onRefreshSignal } from "../git/runtime";
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
export function GitActions({ root, labelled = false }: { root: string; labelled?: boolean }): JSX.Element {
	const { t } = useTranslation();
	const [ab, setAb] = useState<{ ahead: number; behind: number } | null>(null);
	const [stat, setStat] = useState({ additions: 0, deletions: 0, untrackedTruncated: false });
	const [busy, setBusy] = useState<ActionKind | null>(null);
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
			fn()
				.then((outcome) => {
					if (outcome !== "done") return;
					emitRefreshSignal();
					reload();
				})
				.catch((err: unknown) => notifyError(String(err instanceof Error ? err.message : err), err))
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

	/** One toolbar action, rendered either as a bare icon or as a labelled segment. */
	const items: Array<{
		kind: ActionKind;
		/** Visible label; kept short so the segments stay compact. */
		label: string;
		/** Tooltip, where the longer explanation lives. */
		title: string;
		icon: (className: string) => JSX.Element;
		count?: number;
		tone?: string;
		onClick: () => void;
	}> = [
		{
			kind: "fetch",
			label: t("action.fetch"),
			title: t("action.fetch"),
			icon: (cn) => <FetchIcon className={cn} />,
			onClick: () => runAction("fetch", async () => (await gitFetch(root), "done")),
		},
		{
			kind: "pull",
			label: t("action.pull"),
			title: t("action.pull"),
			icon: (cn) => <PullIcon className={cn} />,
			count: ab && ab.behind > 0 ? ab.behind : undefined,
			tone: "text-sky-500",
			onClick: () => runAction("pull", async () => (await gitPull(root), "done")),
		},
		{
			kind: "push",
			label: t("action.push"),
			title: t("action.push"),
			icon: (cn) => <PushIcon className={cn} />,
			count: ab && ab.ahead > 0 ? ab.ahead : undefined,
			tone: "text-emerald-500",
			onClick: handlePush,
		},
		{ kind: "sync", label: t("action.syncLabel"), title: t("action.sync"), icon: (cn) => <SyncIcon className={cn} />, onClick: handleSync },
	];

	return (
		<div className="flex items-center gap-2">
			{labelled ? (
				// 宽面板下工具栏空得发慌，四枚裸图标既看不出是一组、也认不出是什么。
				// 合成一枚分段控件并补上文案，待推/待拉的数字跟在文案后面。
				<div className="flex items-center overflow-hidden rounded-lg border border-border/60">
					{items.map((item, index) => (
						<button
							key={item.kind}
							type="button"
							title={item.count ? `${item.title} (${item.count})` : item.title}
							disabled={busy !== null}
							onClick={item.onClick}
							className={`flex h-7 items-center gap-1.5 px-2.5 text-[12px] text-foreground transition-colors hover:bg-accent disabled:opacity-50 ${
								index > 0 ? "border-l border-border/60" : ""
							}`}
						>
							{item.icon(`h-3.5 w-3.5 ${item.count ? (item.tone ?? "") : "text-muted-foreground"} ${spin(item.kind)}`)}
							<span>{item.label}</span>
							{item.count !== undefined && (
								<span className={`text-[11px] font-semibold tabular-nums leading-none ${item.tone ?? ""}`}>{item.count}</span>
							)}
						</button>
					))}
				</div>
			) : (
				<div className="flex items-center gap-0.5">
					{items.map((item) => (
						<Button
							key={item.kind}
							type="button"
							variant="ghost"
							size="xs"
							className="px-1.5"
							title={item.count ? `${item.title} (${item.count})` : item.title}
							disabled={busy !== null}
							onClick={item.onClick}
						>
							{item.icon(`h-4 w-4 ${item.count ? (item.tone ?? "") : "text-muted-foreground"} ${spin(item.kind)}`)}
							{item.count !== undefined && (
								<span className={`text-[11px] font-semibold tabular-nums leading-none ${item.tone ?? ""}`}>{item.count}</span>
							)}
						</Button>
					))}
				</div>
			)}

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
