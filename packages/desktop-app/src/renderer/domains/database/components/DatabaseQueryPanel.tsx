import { format } from "date-fns";
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@astravia/ui";
import { TextCodeEditorView } from "@astravia/theme-ui/file-preview";
import type { DbConnection } from "../../../../preload/api-types/database";
import type { QueryHistoryEntry } from "../lib/query-history";
import { recordSettingsUsage } from "../../settings/components/recordSettingsUsage";
import { DatabaseSectionLabel } from "./DatabaseSectionLabel";
import { DatabaseSurface } from "./DatabaseSurface";

interface DatabaseQueryPanelProps {
	/** V7-② 执行连接：该标签绑定的连接(新建/打开表/首次执行即锁定,对齐 dbx「tab 自带连接」);null = 未绑定(由上层禁用运行)。 */
	connection: DbConnection | null;
	sql: string;
	busy: boolean;
	/** V3-③ 查询历史（最近 N 条，点击回填 SQL）。 */
	history: readonly QueryHistoryEntry[];
	onChange: (value: string) => void;
	onRun: () => void;
	onClearHistory: () => void;
	/** V7-④ 是否伸展为主栏主体：无输出（未执行/空闲）时为 true,编辑器占满空余,对齐 dbx“编辑器为主体、结果面板执行后才展开”;有输出时 false,面板收缩为内容高、结果网格占剩余。 */
	stretch?: boolean;
	/** V7-⑤ 全部可用连接（下拉候选；含当前生效连接）。 */
	connections: readonly DbConnection[];
	/** V7-⑤ 该标签真实绑定的连接名（未绑定=跟随侧栏时为 null，下拉不高亮任何项）。 */
	boundConnectionName: string | null;
	/** V7-⑤ 下拉切换执行连接（对齐 dbx 顶栏连接切换：固定/改绑该标签，清结果保留 SQL）。 */
	onRebindConnection: (connectionName: string) => void;
}

/** SQL 查询面板（B2.6 + V3 + V7-②）：CodeMirror SQL 高亮编辑器 + Ctrl+Enter 执行 + 查询历史，作用于该标签绑定的执行连接。 */
export function DatabaseQueryPanel({
	connection,
	sql,
	busy,
	history,
	onChange,
	onRun,
	onClearHistory,
	stretch = false,
	connections,
	boundConnectionName,
	onRebindConnection,
}: DatabaseQueryPanelProps): JSX.Element {
	const { t } = useTranslation("settings");
	const [historyOpen, setHistoryOpen] = useState(false);

	const run = () => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-run" });
		onRun();
	};

	// V3-② Ctrl+Enter 执行：CodeMirror contenteditable 内 keydown 冒泡到容器，合成事件可捕获。
	const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
			event.preventDefault();
			if (connection) run();
		}
	};

	const replay = (entry: QueryHistoryEntry) => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-history-replay" });
		onChange(entry.sql);
		setHistoryOpen(false);
	};

	const clearHistory = () => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-history-clear" });
		onClearHistory();
	};

	return (
		<DatabaseSurface className={`relative flex flex-col px-4 pb-3.5 pt-3 ${stretch ? "min-h-0 flex-1" : "shrink-0"}`}>
			<div className="flex shrink-0 items-center justify-between gap-3">
				<DatabaseSectionLabel icon="icon-[mdi--code-braces]">{t("databaseQueryTitle")}</DatabaseSectionLabel>
				<div className="flex min-w-0 items-center gap-1.5">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="xs"
								className="max-w-[220px] gap-1 px-1.5"
								aria-label={t("databaseSwitchConnection")}
								title={t("databaseSwitchConnection")}
								disabled={connections.length === 0}
							>
								<span className="icon-[mdi--database-outline] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">{connection?.name ?? t("databaseNoConnectionSelected")}</span>
								<span className="icon-[mdi--chevron-down] h-3 w-3 shrink-0 text-muted-foreground/70" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-60">
							{boundConnectionName === null ? (
								<DropdownMenuItem disabled>
									<span className="icon-[mdi--cursor-default-outline] h-3.5 w-3.5" />
									{t("databaseConnectionFollowSidebar")}
								</DropdownMenuItem>
								) : null}
								{connections.map((item) => {
									const active = item.name === boundConnectionName;
									return (
										<DropdownMenuItem key={item.id} onClick={() => onRebindConnection(item.name)}>
											<span
												className={`icon-[mdi--check] h-3.5 w-3.5 shrink-0 ${active ? "text-primary" : "text-transparent"}`}
											/>
											<span className="min-w-0 flex-1 truncate">{item.name}</span>
										</DropdownMenuItem>
									);
								})}
							</DropdownMenuContent>
						</DropdownMenu>
					<Button
						variant="ghost"
						size="xs"
						aria-label={t("databaseQueryHistory")}
						title={t("databaseQueryHistory")}
						className="px-1.5"
						onClick={() => setHistoryOpen((open) => !open)}
					>
						<span className="icon-[mdi--history] h-3.5 w-3.5" />
					</Button>
				</div>
			</div>

			<div
				className={`mt-2.5 overflow-hidden rounded-lg bg-background/70 ring-1 ring-inset ring-border/50 focus-within:ring-primary/40 ${stretch ? "min-h-0 flex-1" : "h-32 shrink-0"}`}
				onKeyDown={handleKeyDown}
			>
				<TextCodeEditorView
					documentKey="database-query-editor"
					initialValue={sql}
					extension="sql"
					lineEnding="lf"
					value={sql}
					placeholder={t("databaseQueryPlaceholder")}
					onChange={onChange}
				/>
			</div>

			<div className="mt-2 flex shrink-0 items-center justify-between gap-3">
				<p className="min-w-0 truncate text-[11.5px] text-muted-foreground/70">{t("databaseQueryHint")}</p>
				<Button variant="primary" size="sm" disabled={busy || sql.trim() === "" || !connection} onClick={run}>
					{busy ? <span className="icon-[mdi--progress-clock] h-3.5 w-3.5" /> : <span className="icon-[mdi--play] h-3.5 w-3.5" />}
					{busy ? t("databaseRunning") : t("databaseRun")}
				</Button>
			</div>

			{/* V3-③ 查询历史浮层：最近 N 条，点击回填 SQL；清空按钮；外点/点击项关闭。 */}
			{historyOpen ? (
				<div className="absolute inset-0 z-30" onClick={() => setHistoryOpen(false)}>
					<div
						className="absolute right-3 top-full z-10 mt-1.5 w-80 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl"
						onClick={(event: ReactMouseEvent<HTMLDivElement>) => event.stopPropagation()}
					>
						<div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
							<span className="text-[11.5px] font-semibold text-foreground">{t("databaseQueryHistory")}</span>
							{history.length > 0 ? (
								<Button variant="ghost" size="xs" className="px-1.5 text-muted-foreground" onClick={clearHistory}>
									<span className="icon-[mdi--delete-outline] h-3 w-3" />
									{t("databaseQueryHistoryClear")}
								</Button>
							) : null}
						</div>
						<div className="max-h-64 overflow-y-auto py-1">
							{history.length === 0 ? (
								<div className="px-3 py-4 text-center text-[11.5px] text-muted-foreground/60">{t("databaseQueryHistoryEmpty")}</div>
							) : (
								history.map((entry) => (
									<button
										key={entry.id}
										type="button"
										className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-muted/60"
										title={entry.sql}
										onClick={() => replay(entry)}
									>
										<span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
											<span className="icon-[mdi--database-outline] h-3 w-3 shrink-0" />
											<span className="min-w-0 truncate">{entry.connection}</span>
											<span className="ml-auto shrink-0 tabular-nums">{format(new Date(entry.at), "MM-dd HH:mm")}</span>
										</span>
										<span className="truncate font-mono text-[11.5px] text-foreground/85">{entry.sql}</span>
									</button>
								))
							)}
						</div>
					</div>
				</div>
			) : null}
		</DatabaseSurface>
	);
}
