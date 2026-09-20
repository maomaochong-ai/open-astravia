import { useActiveConversation, useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useRef, useState } from "react";
import { diffStatForEntries, resolveRepoRoot, statusPorcelain } from "../git/run";
import { collapseByPath, parseStatus } from "../git/parseStatus";
import {
	getTurnBaseline,
	getTurnDelta,
	onTurnPhase,
	resizePanel,
	setTurnBaseline,
	setTurnDelta,
} from "../git/runtime";
import type { ChangeCode, TurnChangeDelta } from "../git/types";
import { FileIcon, GitIcon } from "./icons";
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

	if (!data) return null;

	const sorted = [...data.entries].sort((a, b) => a.path.localeCompare(b.path));
	const overflow = sorted.length > MAX_ITEMS;
	const shown = overflow ? sorted.slice(0, MAX_ITEMS - 1) : sorted;
	const remaining = sorted.length - shown.length;
	const open = (): void => resizePanel("max");

	return (
		<div className="overflow-hidden rounded-lg border border-border bg-card text-[12px]">
			<button
				type="button"
				onClick={open}
				title={t("turnCard.open")}
				className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left transition-colors hover:bg-accent"
			>
				<GitIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<span className="font-medium text-foreground">{t("turnCard.summary", { count: sorted.length })}</span>
				<span className="ml-auto flex items-center gap-1.5 font-medium tabular-nums">
					<span className="text-emerald-500">+{data.additions}</span>
					<span className="text-rose-500">−{data.deletions}</span>
				</span>
			</button>
			<div className="flex flex-col py-1">
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
							className="flex items-center gap-1.5 px-3 py-1 text-left text-foreground transition-colors hover:bg-accent/50"
						>
							<FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
							<span className="min-w-0 flex-1 truncate">
								<span>{name}</span>
								{dir && <span className="text-muted-foreground/60"> {dir}</span>}
							</span>
							<StatusBadge code={entry.code} />
						</button>
					);
				})}
				{overflow && (
					<button
						type="button"
						onClick={open}
						className="flex items-center gap-1.5 px-3 py-1 text-left font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
					>
						{t("turnCard.viewAll", { count: remaining })}
					</button>
				)}
			</div>
		</div>
	);
}
