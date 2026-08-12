/**
 * 版本历史抽屉（ADR-0069）：倒序列出这份设计的每个版本，带提交那一刻的缩略图，
 * 点「恢复到此」把内容写回。
 *
 * 悬浮在画布右侧——备注抽屉在左，两个面板可以同时开着互不遮挡。
 */
import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useState } from "react";
import { toVettaFileUrl } from "../cards/file-url";
import { ConfirmDialog } from "../canvas/ConfirmDialog";
import { getPluginCtx } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import { type HistoryCommit, listHistory } from "./history-client";
import { thumbsDirOf } from "./history-paths";
import { restoreDesign } from "./restore";

const PANEL_WIDTH = 300;
const PANEL_GAP = 12;
const PANEL_MAX_HEIGHT = "80%";

interface HistoryEntry extends HistoryCommit {
	/** 提交时存下的缩略图（vetta-file:// 地址）。可能为空——位图还没刷新出来就没存。 */
	thumbs: string[];
}

async function loadThumbs(designDir: string, sha: string): Promise<string[]> {
	try {
		const entries = await getPluginCtx().fs.readDir(thumbsDirOf(designDir, sha));
		return entries
			.filter((entry) => !entry.isDirectory && entry.name.endsWith(".jpg"))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((entry) => toVettaFileUrl(entry.path));
	} catch {
		return [];
	}
}

/** 「刚刚 / 12 分钟前 / 3 小时前 / 具体日期」。 */
function useRelativeTime(): (timestamp: number) => string {
	const { t } = useTranslation();
	return useCallback(
		(timestamp: number) => {
			const minutes = Math.floor((Date.now() - timestamp) / 60_000);
			if (minutes < 1) return t("history.time.now");
			if (minutes < 60) return t("history.time.minutes", { count: minutes });
			const hours = Math.floor(minutes / 60);
			if (hours < 24) return t("history.time.hours", { count: hours });
			return new Date(timestamp).toLocaleDateString();
		},
		[t],
	);
}

interface HistoryDrawerProps {
	session: DesignSession;
	/** 正在查看的版本，画布此刻装的就是它。 */
	peekSha: string | null;
	onPeek(target: HistoryCommit): void;
	onClose(): void;
}

export function HistoryDrawer({ session, peekSha, onPeek, onClose }: HistoryDrawerProps) {
	const { t } = useTranslation();
	const relativeTime = useRelativeTime();
	const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [confirming, setConfirming] = useState<HistoryCommit | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const commits = await listHistory(getPluginCtx(), session.dirPath);
			const withThumbs = await Promise.all(
				commits.map(async (commit) => ({ ...commit, thumbs: await loadThumbs(session.dirPath, commit.sha) })),
			);
			setEntries(withThumbs);
			setFailed(false);
		} catch {
			// 历史读不出来（runner 物化失败、目录被删）——给一句话，别给空列表：
			// 空列表读起来像「这份设计没有历史」，而事实是「读不到」。
			setEntries([]);
			setFailed(true);
		}
	}, [session.dirPath]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const restore = async (target: HistoryCommit): Promise<void> => {
		setConfirming(null);
		setBusy(target.sha);
		try {
			await restoreDesign(getPluginCtx(), session.dirPath, target, { session });
			await refresh();
		} catch {
			setFailed(true);
		} finally {
			setBusy(null);
		}
	};

	return (
		<div
			className="vetd-note vetd-note-drawer-enter vetd-note-surface pointer-events-auto absolute z-40 flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-popover/95 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl"
			style={{ top: PANEL_GAP, right: PANEL_GAP, width: PANEL_WIDTH, maxHeight: PANEL_MAX_HEIGHT }}
			// 截断指针事件：画布根上的 onPointerDown 会 setPointerCapture 到容器，把
			// 后续事件全部重定向走，落在这里的按钮就永远收不到 click。备注抽屉不需要
			// 这一手，是因为它只在备注工具下渲染，而那条分支在捕获之前就 return 了；
			// 这个面板在默认的选择工具下开着，正好落进框选分支。同 ControlBar。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
		>
			<header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2.5">
				<span className="text-xs font-semibold text-foreground">{t("history.drawer.title")}</span>
				<button
					type="button"
					title={t("history.close")}
					aria-label={t("history.close")}
					onClick={onClose}
					className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
						<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
					</svg>
				</button>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{entries === null ? <p className="px-3 py-8 text-center text-xs text-muted-foreground">…</p> : null}
				{entries !== null && entries.length === 0 ? (
					<p className="px-3 py-8 text-center text-xs leading-relaxed text-muted-foreground">
						{failed ? t("history.drawer.failed") : t("history.drawer.empty")}
					</p>
				) : null}

				{entries?.map((entry, index) => (
					<article
						key={entry.sha}
						className="rounded-xl px-2.5 py-2 transition-colors hover:bg-accent/50"
						aria-label={entry.title}
					>
						<div className="flex items-baseline gap-1.5">
							<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{entry.title}</span>
							{index === 0 ? (
								<span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
									{t("history.current")}
								</span>
							) : null}
						</div>
						<p className="truncate pt-0.5 text-[10px] text-muted-foreground">
							{relativeTime(entry.timestamp)}
							{entry.files.length > 0 ? ` · ${entry.files.join("、")}` : ""}
						</p>
						{entry.thumbs.length > 0 ? (
							<div className="flex gap-1 pt-1.5">
								{entry.thumbs.map((thumb) => (
									<img
										key={thumb}
										src={thumb}
										alt=""
										className="h-14 w-auto max-w-[76px] rounded-md border border-border/60 object-cover object-top"
										draggable={false}
									/>
								))}
							</div>
						) : null}
						{index > 0 ? (
							<div className="flex gap-1 pt-1.5">
								{/* 先看后决定：查看是可丢弃的临时态，恢复才写进历史。 */}
								<button
									type="button"
									disabled={busy !== null}
									onClick={() => onPeek(entry)}
									className={`rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-45 ${
										peekSha === entry.sha
											? "border-primary/60 bg-primary/10 text-primary"
											: "border-border/70 text-foreground hover:bg-accent"
									}`}
								>
									{peekSha === entry.sha ? t("history.peeking") : t("history.peek")}
								</button>
								<button
									type="button"
									disabled={busy !== null}
									onClick={() => setConfirming(entry)}
									className="rounded-lg border border-border/70 px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-45"
								>
									{busy === entry.sha ? t("history.restoring") : t("history.restore")}
								</button>
							</div>
						) : null}
					</article>
				))}
			</div>

			{confirming ? (
				<ConfirmDialog
					title={t("history.confirm.title")}
					description={t("history.confirm.desc", { name: confirming.title })}
					confirmLabel={t("history.confirm.ok")}
					cancelLabel={t("history.confirm.cancel")}
					onConfirm={() => void restore(confirming)}
					onCancel={() => setConfirming(null)}
				/>
			) : null}
		</div>
	);
}
