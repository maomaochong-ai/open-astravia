import { useTranslation } from "@vetta-org/plugin-sdk";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@vetta-org/ui";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveDiffScope } from "../git/aiContext";
import { generateCommitMessage } from "../git/aiMessage";
import { loadDraft, saveDraft } from "../git/draftStore";
import { readMergeMessage } from "../git/mergeMsg";
import { gitCommit, gitPush, headCommitMessage } from "../git/run";
import { emitRefreshSignal, notifyError, onCommitRequest } from "../git/runtime";
import type { StatusGroups } from "../git/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { CheckIcon, ChevronIcon, CommitIcon, SparkleIcon, StopIcon } from "./icons";
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

	const disabledReason = hasConflicts ? t("commit.blockedByConflicts") : !hasAnyChange ? t("commit.nothingToCommit") : null;
	const canCommit = pending === null && disabledReason === null && message.trim().length > 0;

	const run = useCallback(
		(kind: Exclude<Pending, null>, task: () => Promise<void>) => {
			setPending(kind);
			task()
				.then(async () => {
					setMessage("");
					await saveDraft(root, "");
					emitRefreshSignal();
				})
				.catch((err: unknown) => notifyError(t("commit.failed"), err))
				.finally(() => setPending(null));
		},
		[root, t],
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
				if (raw === "empty-diff") notifyError(t("ai.emptyDiff"));
				else notifyError(t("ai.failed"), err);
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

	const stagedCount = groups.staged.length;
	// 两半共用同一档绿：禁用时压成同色系的灰绿，而不是换成中性灰——后者会让按钮
	// 断成「一块灰 + 一块绿」两个物件。
	const commitTone = canCommit ? "bg-[#1f883d] text-white hover:bg-[#1a7f37]" : "bg-[#1f883d]/35 text-white/60";

	return (
		<div className="shrink-0 px-2 pb-2 pt-1">
			<div className="overflow-hidden rounded-lg border border-border/70 bg-background transition-shadow focus-within:ring-1 focus-within:ring-ring/40">
				<div className="px-2.5 pt-1.5 text-[11.5px] font-medium text-muted-foreground">{t("commit.title")}</div>

				<textarea
					ref={textareaRef}
					value={message}
					readOnly={generating}
					onChange={(event) => setMessage(event.target.value)}
					onKeyDown={onKeyDown}
					rows={3}
					placeholder={t("commit.placeholder")}
					// resize-y：高度交给用户拖，不再由脚本每次输入都重算（那会把手动拖动的高度顶掉）。
					className="block max-h-64 min-h-[64px] w-full resize-y bg-transparent px-2.5 py-1.5 text-[12.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
				/>

				<div className="flex items-center gap-2 px-1.5 pb-1">
					{/* 与宿主设置里的「让 Vetta 帮您配置」同款：透明底、主题色文字，不跟提交按钮抢。 */}
					<button
						type="button"
						disabled={pending !== null || (!generating && !hasAnyChange)}
						title={generating ? t("ai.stop") : t("ai.generateHint")}
						onClick={() => (generating ? abortRef.current?.abort() : requestGenerate())}
						className="git-ai-accent inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md border border-transparent bg-transparent px-1 text-[12px] font-medium outline-none transition-opacity hover:opacity-80 focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50"
					>
						{generating ? <StopIcon className="h-3.5 w-3.5 shrink-0" /> : <SparkleIcon className="h-3.5 w-3.5 shrink-0" />}
						<span className="git-ai-shimmer truncate">{generating ? t("ai.stop") : t("ai.generate")}</span>
					</button>
					{stagedCount > 0 && (
						<span className="ml-auto flex min-w-0 shrink-0 items-center gap-1 pr-1 text-[11px] text-muted-foreground">
							<CheckIcon className="h-3 w-3 shrink-0 text-emerald-500" />
							<span className="truncate">{t("commit.stagedCount", { count: stagedCount })}</span>
						</span>
					)}
				</div>


			</div>

			{/* 主操作放在卡片外：它是对这张卡片的执行，不是卡片的一部分；圆角与卡片同档。 */}
			<div className="mt-1.5 flex items-stretch overflow-hidden rounded-lg">
				<button
					type="button"
					disabled={!canCommit}
					title={disabledReason ?? undefined}
					onClick={commit}
					className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 px-2 text-[12px] font-medium transition-colors ${commitTone}`}
				>
					<CommitIcon className="h-3.5 w-3.5 shrink-0" />
					<span className="truncate">{label}</span>
				</button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							disabled={pending !== null}
							title={t("commit.more")}
							// 分隔线只占八成高度并居中：通高的那条会把按钮视觉上劈成两半。
							className={`relative flex h-8 w-8 shrink-0 items-center justify-center transition-colors before:absolute before:left-0 before:top-[10%] before:h-[80%] before:w-px before:bg-white/15 ${commitTone}`}
						>
							<ChevronIcon className="h-3.5 w-3.5" />
						</button>
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
			{pending !== null && <div className="px-1 pt-1 text-[11px] text-muted-foreground">{t("commit.hookHint")}</div>}

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
