/**
 * 版本历史抽屉（ADR-0069）：一条时间线，最新在上，每条给「查看」和「恢复」。
 *
 * 悬浮在画布右上角，入口按钮就在它正上方——面板与开关同处一角。开关不放进 ControlBar：
 * 那一排是「用什么工具画」，翻历史不属于那件事。
 */
import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "../canvas/ConfirmDialog";
import { getPluginCtx } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import { type HistoryCommit, listHistory } from "./history-client";
import { onHistoryChanged } from "./history-events";
import { restoreDesign } from "./restore";

const PANEL_WIDTH = 292;

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

/** 变更文件的短名：`frames/login.tsx` → `login`，一眼认出改了哪几屏。 */
function shortNames(files: readonly string[]): string {
	const names = files
		// design.json 每次都在里面（画框位置），列出来只是噪音。
		.filter((file) => file !== "design.json")
		.map((file) => (file.split("/").pop() ?? file).replace(/\.(tsx|css|json|md)$/, ""));
	if (names.length === 0) return "";
	if (names.length <= 3) return names.join("、");
	return `${names.slice(0, 3).join("、")} +${names.length - 3}`;
}

interface HistoryDrawerProps {
	session: DesignSession;
	/** 正在查看的版本，画布此刻装的就是它。 */
	peekSha: string | null;
	onPeek(target: HistoryCommit): void;
	/** 恢复完成后画布要硬重载：整份内容换掉了，增量热更新那条路指望不上。 */
	onRestored(): void;
	/** 查看模式的横幅压在画布顶部，面板要给它让位。 */
	offsetTop: number;
	onClose(): void;
}

export function HistoryDrawer({ session, peekSha, onPeek, onRestored, offsetTop, onClose }: HistoryDrawerProps) {
	const { t } = useTranslation();
	const relativeTime = useRelativeTime();
	const [entries, setEntries] = useState<HistoryCommit[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [confirming, setConfirming] = useState<HistoryCommit | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			setEntries(await listHistory(getPluginCtx(), session.dirPath));
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

	// 版本是在回合结束的 hook 里落的，与这个面板没有父子关系。不订阅的话，agent 干完
	// 活面板还停在旧列表上，用户得关掉重开才看得到新版本。
	useEffect(() => onHistoryChanged((designDir) => {
		if (designDir === session.dirPath) void refresh();
	}), [refresh, session.dirPath]);

	const restore = async (target: HistoryCommit): Promise<void> => {
		setConfirming(null);
		setBusy(target.sha);
		try {
			await restoreDesign(getPluginCtx(), session.dirPath, target, { session });
			onRestored();
			await refresh();
		} catch {
			setFailed(true);
		} finally {
			setBusy(null);
		}
	};

	const total = entries?.length ?? 0;

	return (
		<div
			className="vetd-note vetd-note-surface vetd-note-drawer-enter pointer-events-auto absolute z-40 flex flex-col overflow-hidden rounded-xl border border-border/60 bg-popover/95 shadow-xl ring-1 ring-black/5 backdrop-blur-xl"
			style={{ top: 52 + offsetTop, right: 12, width: PANEL_WIDTH, maxHeight: "min(70%, 560px)" }}
			// 截断指针事件：画布根上的 onPointerDown 会 setPointerCapture 到容器，把后续
			// 事件全部重定向走，落在这里的按钮就永远收不到 click。同 ControlBar。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
		>
			<header className="flex shrink-0 items-center gap-2 px-3.5 pb-2 pt-3">
				<span className="text-[13px] font-semibold tracking-tight text-foreground">{t("history.drawer.title")}</span>
				{total > 0 ? <span className="text-[11px] tabular-nums text-muted-foreground/60">{total}</span> : null}
				<button
					type="button"
					title={t("history.close")}
					aria-label={t("history.close")}
					onClick={onClose}
					className="-mr-1 ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
				>
					<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
						<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
					</svg>
				</button>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				{entries === null ? (
					<p className="px-2 py-8 text-center text-xs text-muted-foreground/60">{t("history.loading")}</p>
				) : null}
				{entries !== null && total === 0 ? (
					<p className="px-3 py-8 text-center text-xs leading-relaxed text-muted-foreground">
						{failed ? t("history.drawer.failed") : t("history.drawer.empty")}
					</p>
				) : null}

				{entries?.map((entry, index) => {
					const isCurrent = index === 0;
					const isPeeking = peekSha === entry.sha;
					const changed = shortNames(entry.files);
					return (
						<article
							key={entry.sha}
							aria-label={entry.title}
							aria-current={isPeeking ? "true" : undefined}
							className={`group relative rounded-lg py-2 pl-7 pr-2 transition-colors ${
								isPeeking ? "bg-primary/[0.07]" : "hover:bg-accent/40"
							}`}
						>
							{/* 时间线：竖线连起整列，圆点标出这一条；当前版本实心。 */}
							<span
								aria-hidden
								className="absolute left-[13px] w-px bg-border/60"
								style={{ top: isCurrent ? 15 : 0, bottom: index === total - 1 ? "auto" : 0, height: index === total - 1 ? 15 : undefined }}
							/>
							<span
								aria-hidden
								className={`absolute left-[9px] top-[11px] size-2 rounded-full ring-2 ring-popover ${
									isCurrent ? "bg-primary" : isPeeking ? "bg-primary/60" : "bg-border"
								}`}
							/>

							<div className="flex items-start gap-1.5">
								<p className="line-clamp-2 min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-foreground">
									{entry.title}
								</p>
								{isCurrent ? (
									<span className="mt-px shrink-0 text-[10px] font-medium text-primary">{t("history.current")}</span>
								) : null}
							</div>

							<p className="truncate pt-0.5 text-[11px] text-muted-foreground/80">
								{relativeTime(entry.timestamp)}
								{changed ? <span className="text-muted-foreground/60"> · {changed}</span> : null}
							</p>

							{!isCurrent ? (
								// 悬停才露出动作：静态时列表就是一条干净的时间线。
								<div className="mt-1.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
									<button
										type="button"
										disabled={busy !== null}
										onClick={() => onPeek(entry)}
										className={`rounded-md px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-45 ${
											isPeeking
												? "bg-primary/15 font-medium text-primary opacity-100"
												: "text-muted-foreground hover:bg-accent hover:text-foreground"
										}`}
									>
										{isPeeking ? t("history.peeking") : t("history.peek")}
									</button>
									<button
										type="button"
										disabled={busy !== null}
										onClick={() => setConfirming(entry)}
										className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-45"
									>
										{busy === entry.sha ? t("history.restoring") : t("history.restore")}
									</button>
								</div>
							) : null}
						</article>
					);
				})}
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
