import { useState, type JSX } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@astravia/ui";
import { useTranslation } from "react-i18next";
import type { QueryHistoryEntry } from "../lib/query-history";

interface DatabaseQueryHistoryPopoverProps {
	/** 最近查询（模型 history，最新在前）。 */
	entries: readonly QueryHistoryEntry[];
	/** 恢复：在新查询标签打开该条 SQL（对齐 dbx QueryHistory 的 restore）。 */
	onRestore: (entry: QueryHistoryEntry) => void;
	/** 复制该条 SQL。 */
	onCopy: (entry: QueryHistoryEntry) => void;
	/** 删除单条。 */
	onDelete: (id: string) => void;
	/** 清空全部。 */
	onClear: () => void;
	/** P2 历史条目「AI 分析」：带该条 SQL + 连接打开会话预填问题。 */
	onAnalyze: (entry: QueryHistoryEntry) => void;
}

function formatEntryTime(at: number, locale: string): string {
	const date = new Date(at);
	const now = Date.now();
	const diffMin = Math.floor((now - at) / 60_000);
	if (diffMin < 1) return locale.startsWith("zh") ? "刚刚" : "just now";
	if (diffMin < 60) {
		return locale.startsWith("zh") ? `${diffMin} 分钟前` : `${diffMin} min ago`;
	}
	const diffH = Math.floor(diffMin / 60);
	if (diffH < 24) {
		return locale.startsWith("zh") ? `${diffH} 小时前` : `${diffH} h ago`;
	}
	const diffD = Math.floor(diffH / 24);
	if (diffD < 7) return locale.startsWith("zh") ? `${diffD} 天前` : `${diffD} d ago`;
	return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/**
 * 顶栏「查询历史」浮层（#2 对齐 dbx QueryHistory）：
 * 最近执行的 SQL 列表（连接 + 时间），逐条「恢复/复制/删除」，底部清空。
 * 入口挂在 DatabaseWorkspaceHeader 的 actions 区，与「新建查询」「问数」并排。
 */
export function DatabaseQueryHistoryPopover({
	entries,
	onRestore,
	onCopy,
	onDelete,
	onClear,
	onAnalyze,
}: DatabaseQueryHistoryPopoverProps): JSX.Element {
	const { t, i18n } = useTranslation("settings");
	const locale = i18n.language ?? "en";
	const [filterText, setFilterText] = useState("");
	const keyword = filterText.trim().toLowerCase();
	const visibleEntries = keyword
		? entries.filter(
				(entry) => entry.sql.toLowerCase().includes(keyword) || entry.connection.toLowerCase().includes(keyword),
			)
		: entries;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 shrink-0 gap-1.5 px-2 text-[12px] font-medium"
					aria-label={t("databaseHistory")}
					title={t("databaseHistory")}
				>
					<span className="icon-[lucide--clock-arrow-up] h-4 w-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" sideOffset={6} className="w-[380px] p-0">
				<div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
					<span className="text-[12px] font-semibold text-foreground">{t("databaseHistory")}</span>
					{entries.length > 0 ? (
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
							onClick={onClear}
						>
							<span className="icon-[lucide--trash-2] h-3.5 w-3.5" />
							{t("databaseHistoryClearAll")}
						</Button>
					) : null}
				</div>
				{entries.length > 0 ? (
					<div className="border-b border-border/40 px-2 py-1.5">
						<input
							value={filterText}
							type="text"
							placeholder={t("databaseHistorySearch")}
							aria-label={t("databaseHistorySearch")}
							onChange={(event) => setFilterText(event.target.value)}
							className="h-7 w-full rounded-md border border-border/60 bg-background px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus-visible:border-primary/50"
						/>
					</div>
				) : null}
				{visibleEntries.length === 0 ? (
					<div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
						<span className="icon-[lucide--clock-arrow-up] h-6 w-6 text-muted-foreground/40" />
						<span className="text-[12px] text-muted-foreground/70">
							{entries.length === 0 ? t("databaseHistoryEmpty") : t("databaseHistoryEmptyFiltered")}
						</span>
					</div>
				) : (
					<ul className="max-h-[420px] overflow-y-auto p-1">
						{visibleEntries.map((entry) => (
							<li key={entry.id} className="group flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-muted/50">
								<button
									type="button"
									className="w-full cursor-pointer text-left"
									title={t("databaseHistoryRestore")}
									onClick={() => onRestore(entry)}
								>
									<code className="block w-full truncate font-mono text-[11.5px] text-foreground">
										{entry.sql.trim()}
									</code>
								</button>
								<div className="flex items-center gap-2">
									<span className="max-w-[130px] truncate rounded bg-muted/60 px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">
										{entry.connection}
									</span>
									<span className="text-[10.5px] text-muted-foreground/60">
										{formatEntryTime(entry.at, locale)}
									</span>
									<span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
											aria-label={t("databaseHistoryRestore")}
											title={t("databaseHistoryRestore")}
											onClick={() => onRestore(entry)}
										>
											<span className="icon-[lucide--rotate-ccw-clock] h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
											aria-label={t("databaseAnalyzeHistory.label")}
											title={t("databaseAnalyzeHistory.label")}
											onClick={() => onAnalyze(entry)}
										>
											<span className="icon-[lucide--wand-sparkles] h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
											aria-label={t("databaseHistoryCopy")}
											title={t("databaseHistoryCopy")}
											onClick={() => onCopy(entry)}
										>
											<span className="icon-[lucide--copy] h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
											aria-label={t("databaseHistoryDelete")}
											title={t("databaseHistoryDelete")}
											onClick={() => onDelete(entry.id)}
										>
											<span className="icon-[lucide--trash-2] h-3.5 w-3.5" />
										</Button>
									</span>
								</div>
							</li>
						))}
					</ul>
				)}
			</PopoverContent>
		</Popover>
	);
}
