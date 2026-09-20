import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@vetta-org/ui";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveDiffScope } from "../git/aiContext";
import { generateCommitMessage } from "../git/aiMessage";
import { loadDraft, saveDraft } from "../git/draftStore";
import { readMergeMessage } from "../git/mergeMsg";
import { gitCommit, gitPush, headCommitMessage } from "../git/run";
import { emitRefreshSignal, onCommitRequest } from "../git/runtime";
import type { StatusGroups } from "../git/types";
import { CommitErrorPanel } from "./CommitErrorPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { ChevronIcon, SparkleIcon, StopIcon } from "./icons";
import { useGitSettings } from "./useGitSettings";

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
	const settings = useGitSettings();
	const [message, setMessage] = useState("");
	const [pending, setPending] = useState<Pending>(null);
	const [error, setError] = useState<string | null>(null);
	const [generating, setGenerating] = useState(false);
	const [askOverwrite, setAskOverwrite] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
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
		run("commit", async () => {
			await gitCommit(root, message, { stageAll });
			// 配置开了「提交后自动推送」时，主按钮就等于提交并推送。
			if (settings.pushAfterCommit) await gitPush(root);
		});
	}, [canCommit, run, root, message, stageAll, settings.pushAfterCommit]);

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

	/**
	 * Generate into the box. The scope comes from the same function the commit path
	 * uses, so the message always describes exactly what the button will commit.
	 */
	const generate = useCallback(() => {
		if (generating || pending !== null || !hasAnyChange) return;
		const controller = new AbortController();
		abortRef.current = controller;
		setGenerating(true);
		setError(null);
		void generateCommitMessage({
			root,
			scope: resolveDiffScope(hasStaged),
			template: settings.messageTemplate,
			modelKey: settings.modelKey ?? undefined,
			signal: controller.signal,
			// 流式回填：生成期间 textarea 只读，避免光标与流入的文本打架。
			onDelta: (text) => setMessage(text),
		})
			.then((text) => setMessage(text))
			.catch((err: unknown) => {
				if (controller.signal.aborted) return;
				const raw = err instanceof Error ? err.message : String(err);
				setError(raw === "empty-diff" ? t("ai.emptyDiff") : `${t("ai.failed")}\n\n${raw}`);
			})
			.finally(() => {
				abortRef.current = null;
				setGenerating(false);
			});
	}, [generating, pending, hasAnyChange, root, hasStaged, settings.messageTemplate, settings.modelKey, t]);

	// 已有内容时先问一句，避免一键抹掉用户手写的信息。
	const requestGenerate = useCallback(() => {
		if (message.trim().length > 0) setAskOverwrite(true);
		else generate();
	}, [message, generate]);

	// turn 卡把本轮文件暂存好之后会点过来：聚焦输入框并顺手起一份草稿。
	useEffect(
		() =>
			onCommitRequest((requestedRoot) => {
				if (requestedRoot !== root) return;
				textareaRef.current?.focus();
				requestGenerate();
			}),
		[root, requestGenerate],
	);

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			commit();
		}
	};

	const label =
		pending !== null
			? t("commit.running")
			: stageAll
				? t("commit.stageAllAndCommit")
				: settings.pushAfterCommit
					? t("commit.andPush")
					: t("commit.action");

	return (
		<div className="shrink-0 border-b border-border">
			<div className="relative px-2 pt-2">
				<textarea
					ref={textareaRef}
					value={message}
					readOnly={generating}
					onChange={(event) => setMessage(event.target.value)}
					onKeyDown={onKeyDown}
					rows={1}
					placeholder={t("commit.placeholder")}
					className="w-full resize-none rounded-md border border-border bg-background py-1.5 pl-2 pr-8 text-[12px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-ring"
				/>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="absolute bottom-1 right-3"
					disabled={pending !== null || (!generating && !hasAnyChange)}
					title={generating ? t("ai.stop") : t("ai.generate")}
					onClick={() => (generating ? abortRef.current?.abort() : requestGenerate())}
				>
					{generating ? <StopIcon className="h-3 w-3 text-muted-foreground" /> : <SparkleIcon className="h-3.5 w-3.5 text-sky-500" />}
				</Button>
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

			<ConfirmDialog
				open={askOverwrite}
				title={t("ai.overwriteTitle")}
				description={t("ai.overwriteDescription")}
				confirmLabel={t("ai.overwriteConfirm")}
				onConfirm={() => {
					setAskOverwrite(false);
					generate();
				}}
				onCancel={() => setAskOverwrite(false)}
			/>
		</div>
	);
}
