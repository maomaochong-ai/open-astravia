import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@vetta-org/ui";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadDraft, saveDraft } from "../git/draftStore";
import { readMergeMessage } from "../git/mergeMsg";
import { gitCommit, gitPush, headCommitMessage } from "../git/run";
import { emitRefreshSignal } from "../git/runtime";
import type { StatusGroups } from "../git/types";
import { CommitErrorPanel } from "./CommitErrorPanel";
import { ChevronIcon } from "./icons";

/** Draft writes are debounced so typing does not hit storage on every keystroke. */
const DRAFT_SAVE_DEBOUNCE_MS = 500;

type Pending = "commit" | "commitPush" | "amend" | null;

/**
 * Message box + commit controls, pinned above the change sections.
 *
 * It deliberately sits in the same column as the file list: committing is an
 * action on that list, and in the narrow panel (the common case) the two are the
 * only things on screen.
 */
export function CommitBox({ root, groups }: { root: string; groups: StatusGroups }): JSX.Element {
	const { t } = useTranslation();
	const [message, setMessage] = useState("");
	const [pending, setPending] = useState<Pending>(null);
	const [error, setError] = useState<string | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	// Guards the draft effect from writing back the draft it just loaded.
	const hydratedRef = useRef(false);

	const hasStaged = groups.staged.length > 0;
	const hasConflicts = groups.conflict.length > 0;
	const hasAnyChange = groups.staged.length + groups.unstaged.length > 0;
	// Empty index + dirty worktree: the button stages everything rather than
	// sitting disabled, which is where a newcomer otherwise gets stuck.
	const stageAll = !hasStaged && groups.unstaged.length > 0;

	// 载入该仓库的草稿；没有草稿时用 git 为进行中的合并准备好的 MERGE_MSG 兜底。
	useEffect(() => {
		let alive = true;
		hydratedRef.current = false;
		void (async () => {
			const draft = await loadDraft(root);
			const initial = draft.length > 0 ? draft : ((await readMergeMessage(root)) ?? "");
			if (!alive) return;
			setMessage(initial);
			hydratedRef.current = true;
		})();
		return () => {
			alive = false;
		};
	}, [root]);

	useEffect(() => {
		if (!hydratedRef.current) return;
		const timer = setTimeout(() => void saveDraft(root, message), DRAFT_SAVE_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [root, message]);

	// 自适应高度：1 行起，超过上限后内部滚动。
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
	}, [message]);

	const disabledReason = hasConflicts ? t("commit.blockedByConflicts") : !hasAnyChange ? t("commit.nothingToCommit") : null;
	const canCommit = pending === null && disabledReason === null && message.trim().length > 0;

	const run = useCallback(
		(kind: Exclude<Pending, null>, task: () => Promise<void>) => {
			setPending(kind);
			setError(null);
			task()
				.then(async () => {
					setMessage("");
					await saveDraft(root, "");
					emitRefreshSignal();
				})
				.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
				.finally(() => setPending(null));
		},
		[root],
	);

	const commit = useCallback(() => {
		if (!canCommit) return;
		run("commit", () => gitCommit(root, message, { stageAll }));
	}, [canCommit, run, root, message, stageAll]);

	const commitAndPush = useCallback(() => {
		if (!canCommit) return;
		run("commitPush", async () => {
			await gitCommit(root, message, { stageAll });
			await gitPush(root);
		});
	}, [canCommit, run, root, message, stageAll]);

	const amend = useCallback(() => {
		if (pending !== null || hasConflicts) return;
		run("amend", async () => {
			// Amending with an empty box would wipe the previous message; reuse it.
			const text = message.trim().length > 0 ? message : await headCommitMessage(root);
			await gitCommit(root, text, { stageAll, amend: true });
		});
	}, [pending, hasConflicts, run, root, message, stageAll]);

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			commit();
		}
	};

	const label = pending !== null ? t("commit.running") : stageAll ? t("commit.stageAllAndCommit") : t("commit.action");

	return (
		<div className="shrink-0 border-b border-border">
			<div className="px-2 pt-2">
				<textarea
					ref={textareaRef}
					value={message}
					onChange={(event) => setMessage(event.target.value)}
					onKeyDown={onKeyDown}
					rows={1}
					placeholder={t("commit.placeholder")}
					className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-[12px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-ring"
				/>
			</div>
			<div className="flex items-center gap-1 px-2 py-1.5">
				<Button
					type="button"
					size="xs"
					className="flex-1"
					disabled={!canCommit}
					title={disabledReason ?? undefined}
					onClick={commit}
				>
					{label}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button type="button" size="xs" variant="secondary" className="px-1" disabled={pending !== null} title={t("commit.more")}>
							<ChevronIcon className="h-3.5 w-3.5" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" data-vetta-plugin-root="git">
						<DropdownMenuItem disabled={!canCommit} onSelect={commitAndPush}>
							{t("commit.andPush")}
						</DropdownMenuItem>
						<DropdownMenuItem disabled={pending !== null || hasConflicts} onSelect={amend}>
							{t("commit.amend")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{/* pre-commit 钩子可能跑很久，必须给出「还在跑」的明确信号，而不是只让按钮转圈。 */}
			{pending !== null && <div className="px-2 pb-1.5 text-[11px] text-muted-foreground">{t("commit.hookHint")}</div>}
			{error && <CommitErrorPanel message={error} onDismiss={() => setError(null)} />}
		</div>
	);
}
