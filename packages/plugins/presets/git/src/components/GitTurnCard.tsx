import { useActiveConversation, useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta-org/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { diffStatForEntries, resolveRepoRoot, stagePaths, statusPorcelain, unstageAll } from "../git/run";
import { collapseByPath, parseStatus } from "../git/parseStatus";
import {
	emitRefreshSignal,
	getTurnBaseline,
	getTurnDelta,
	onTurnPhase,
	requestCommit,
	openPanel,
	setTurnBaseline,
	setTurnDelta,
} from "../git/runtime";
import type { ChangeCode, TurnChangeDelta } from "../git/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileTypeIcon } from "./FileTypeIcon";
import { GitIcon } from "./icons";
import { StatusBadge } from "./StatusBadge";

/** Most items the card shows inline; beyond this it collapses to a "view all" row. */
const MAX_ITEMS = 10;

/**
 * 消息列表底部的 Git 「本轮变更」卡（turn 卡，不绑定 tool 调用）。
 *
 * 仅显示**本轮对话**产生的变更，不是全部未提交文件——做法：维护一份「上一轮结束时的
 * `git status`」基线（path→状态），一轮结束后只列相对基线「新增/状态变化」的条目。
 * 基线与计算结果都按 cwd 持久化在插件 runtime（globalThis）上，因此**切换会话再切回来
 * 仍能恢复上一轮的卡**，且不依赖捕捉 turn-start（组件可能在首轮 turn-start 之后才挂载）。
 * 基线在挂载时初始化、每轮 turn-end 计算后更新为当前状态。turn 进行中隐藏。
 * 列全本轮变更，最多 {@link MAX_ITEMS} 项，超出折叠为「查看所有变更」。
 * 任意行点击都打开活动面板的 Git 变更视图看完整列表 / diff。
 */
export function GitTurnCard(): JSX.Element | null {
	const { cwd } = useActiveConversation();
	const { t } = useTranslation();
	const [data, setData] = useState<TurnChangeDelta | null>(null);
	const [busy, setBusy] = useState(false);
	// 暂存区里已经有别的文件，等用户裁决是「一并提交」还是「只提交本轮」。
	const [askMixed, setAskMixed] = useState<{ root: string; paths: string[] } | null>(null);
	const tokenRef = useRef(0);

	useEffect(() => {
		const myToken = ++tokenRef.current;
		if (!cwd) {
			setData(null);
			return;
		}
		// 切回会话：立即复显该 cwd 已持久化的本轮变更。
		setData(getTurnDelta(cwd));

		const snapshot = async (): Promise<Map<string, ChangeCode> | null> => {
			const root = await resolveRepoRoot(cwd);
			if (!root) return null;
			try {
				return new Map(collapseByPath(parseStatus(await statusPorcelain(root))).map((e) => [e.path, e.code]));
			} catch {
				return null;
			}
		};

		// 尚无基线时挂载即建立（捕捉本轮开始前的状态），不等 turn-start。
		if (getTurnBaseline(cwd) === null) {
			void snapshot().then((map) => {
				if (myToken === tokenRef.current && getTurnBaseline(cwd) === null) setTurnBaseline(cwd, map);
			});
		}

		const computeDelta = async (): Promise<void> => {
			const baseline = getTurnBaseline(cwd);
			try {
				const root = await resolveRepoRoot(cwd);
				if (myToken !== tokenRef.current) return;
				if (!root) {
					setTurnDelta(cwd, null);
					setData(null);
					return;
				}
				const current = collapseByPath(parseStatus(await statusPorcelain(root)));
				if (myToken !== tokenRef.current) return;
				const currentMap = new Map(current.map((e) => [e.path, e.code]));
				// 没基线（挂载快照尚未就绪/失败）：本轮不显示，仅把当前状态记为基线，下轮再比。
				if (!baseline) {
					setTurnBaseline(cwd, currentMap);
					setTurnDelta(cwd, null);
					setData(null);
					return;
				}
				// 本轮变更 = 基线中不存在该路径、或状态码与基线不同的条目。
				const delta = current.filter((e) => baseline.get(e.path) !== e.code);
				// 更新基线为本轮结束状态，供下一轮对比（即便下次错过 turn-start 也不会重复计入）。
				setTurnBaseline(cwd, currentMap);
				if (delta.length === 0) {
					setTurnDelta(cwd, null);
					setData(null);
					return;
				}
				const { additions, deletions } = await diffStatForEntries(root, delta);
				if (myToken !== tokenRef.current) return;
				const result: TurnChangeDelta = { entries: delta, additions, deletions };
				setTurnDelta(cwd, result);
				setData(result);
			} catch {
				if (myToken !== tokenRef.current) return;
				setData(null);
			}
		};

		const off = onTurnPhase((phase) => {
			if (phase === "start") {
				// 新一轮开始：隐藏并清掉上一轮的卡。
				setTurnDelta(cwd, null);
				setData(null);
			} else {
				void computeDelta();
			}
		});
		return off;
	}, [cwd]);

	/**
	 * Stage exactly this turn's files, then hand over to the panel's commit box.
	 *
	 * The turn card is the only surface that knows which files belong to THIS turn
	 * (the panel only sees every uncommitted file), which is what makes a one-click
	 * atomic commit possible here.
	 */
	const stageAndCommit = useCallback(
		async (root: string, paths: string[], resetIndexFirst: boolean): Promise<void> => {
			setBusy(true);
			try {
				if (resetIndexFirst) await unstageAll(root);
				await stagePaths(root, paths);
				emitRefreshSignal();
				openPanel();
				requestCommit(root);
			} finally {
				setBusy(false);
			}
		},
		[],
	);

	const commitThisTurn = useCallback((): void => {
		if (!cwd || !data || busy) return;
		const paths = data.entries.map((entry) => entry.path);
		void (async () => {
			const root = await resolveRepoRoot(cwd);
			if (!root) return;
			const groups = parseStatus(await statusPorcelain(root));
			// 暂存区里已经躺着别的文件：直接提交会把它们一起带走，违背原子提交。
			if (groups.staged.length > 0) {
				setAskMixed({ root, paths });
				return;
			}
			await stageAndCommit(root, paths, false);
		})();
	}, [cwd, data, busy, stageAndCommit]);

	if (!data) return null;

	const sorted = [...data.entries].sort((a, b) => a.path.localeCompare(b.path));
	const overflow = sorted.length > MAX_ITEMS;
	const shown = overflow ? sorted.slice(0, MAX_ITEMS - 1) : sorted;
	const remaining = sorted.length - shown.length;
	const open = (): void => openPanel();

	return (
		// 去线留白：卡片只保留一层淡边与内边距，内部各区靠间距分隔，不再用分隔线切块。
		<div className="rounded-lg border border-border/60 bg-card/60 p-2 text-[12px]">
			<div className="flex items-center gap-2 px-1 py-0.5">
				<GitIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<button type="button" onClick={open} title={t("turnCard.open")} className="min-w-0 truncate text-left font-medium text-foreground hover:underline">
					{t("turnCard.summary", { count: sorted.length })}
				</button>
				<span className="ml-auto flex shrink-0 items-center gap-1.5 font-medium tabular-nums">
					<span className="text-emerald-500/90">+{data.additions}</span>
					<span className="text-rose-500/90">−{data.deletions}</span>
				</span>
			</div>

			<div className="mt-1.5 flex flex-col">
				{shown.map((entry) => {
					const slash = entry.path.lastIndexOf("/");
					const dir = slash < 0 ? "" : entry.path.slice(0, slash + 1);
					const name = slash < 0 ? entry.path : entry.path.slice(slash + 1);
					return (
						<button
							type="button"
							key={entry.path}
							onClick={open}
							title={entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}
							className="flex items-center gap-2 rounded-md px-1 py-1 text-left text-foreground transition-colors hover:bg-accent/40"
						>
							<FileTypeIcon path={entry.path} className="h-4 w-4 shrink-0" />
							<span className="min-w-0 flex-1 truncate">
								<span>{name}</span>
								{dir && <span className="text-muted-foreground/50"> {dir}</span>}
							</span>
							<StatusBadge code={entry.code} />
						</button>
					);
				})}
				{overflow && (
					<button
						type="button"
						onClick={open}
						className="rounded-md px-1 py-1 text-left text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
					>
						{t("turnCard.viewAll", { count: remaining })}
					</button>
				)}
			</div>

			<div className="mt-1.5 flex justify-end px-1">
				<Button type="button" size="xs" variant="ghost" className="px-2 text-sky-500 hover:bg-sky-500/10 hover:text-sky-400" disabled={busy} onClick={commitThisTurn}>
					{t("turnCard.commitTurn")}
				</Button>
			</div>

			{/* 默认「仅提交本轮」：取消暂存只动索引、不丢改动，错了点两下就回来；
			    「一并提交」错了则要改历史。默认值必须站在可逆的那一侧。 */}
			<ConfirmDialog
				open={askMixed !== null}
				title={t("turnCard.mixedTitle")}
				description={t("turnCard.mixedDescription")}
				confirmLabel={t("turnCard.mixedOnlyTurn")}
				detail={
					<button
						type="button"
						className="w-full rounded border border-border px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent"
						onClick={() => {
							const target = askMixed;
							setAskMixed(null);
							if (target) void stageAndCommit(target.root, target.paths, false);
						}}
					>
						{t("turnCard.mixedIncludeAll")}
					</button>
				}
				onConfirm={() => {
					const target = askMixed;
					setAskMixed(null);
					if (target) void stageAndCommit(target.root, target.paths, true);
				}}
				onCancel={() => setAskMixed(null)}
			/>
		</div>
	);
}
