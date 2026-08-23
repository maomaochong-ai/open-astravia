import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Spin } from "@astravia/ui";
import { useTranslation } from "react-i18next";
import type { DbQueryResult } from "../../../../preload/api-types/database";
import {
	RESULT_CELL_MAX_CHARS,
	clampPage,
	exportFileName,
	inferColumnKind,
	isNullCell,
	nextSortDirection,
	pageCount,
	pageSlice,
	rowsToCsv,
	rowsToJson,
	rowsToTsv,
	sortRows,
	truncateCell,
	type ResultColumnKind,
	type SortDirection,
} from "../lib/result-grid";
import { recordSettingsUsage } from "../../settings/components/recordSettingsUsage";
import { DatabaseDetail } from "./DatabaseDetail";
import { DatabaseNotice } from "./DatabaseNotice";
import { DatabaseSectionLabel } from "./DatabaseSectionLabel";
import type { DatabaseQueryStatus } from "./useDatabaseQueryModel";
import type { QueryEditabilityReason } from "../lib/sql-editability";

// B3.2-R 自动刷新：默认间隔与可选间隔（秒），对齐 dbx DataGridToolbar autoRefresh 间隔下拉。
const AUTO_REFRESH_DEFAULT_SECONDS = 10;
const AUTO_REFRESH_INTERVALS = [5, 10, 30, 60] as const;

	interface DatabaseResultGridProps {
		status: DatabaseQueryStatus;
		result: DbQueryResult | null;
		connectionName: string | null;
		error: string | null;
		errorDetail: string | null;
		/** V6-② 服务端分页：是否可「下一页」（打开表结果满页假设还有更多，对齐 dbx-main）。 */
		canGoNextPage?: boolean;
		/** V6-② 服务端分页当前页（1-based；自由 SQL / AI 回填为 null 时用客户端分页）。 */
		page?: number | null;
		/** V6-② 服务端分页每页行数（≤ 100，受 dbx-mcp `dbx_execute_query` 上限约束）。 */
		pageSize?: number | null;
		/** V6-② 服务端翻页进行中。 */
		loadingPage?: boolean;
		/** V6-② 服务端翻页：请求指定页（workspace 转调 useDatabaseQueryModel.goToPage）。 */
		onGoToPage?: (page: number) => void;
		/** B2.9-W1 反向：结果工具栏「让 AI 解读此查询」入口（携带当前 SQL + 结果摘要跳转对话）。 */
		onAnalyzeResult?: () => void;
		/** B3.2-R 数据编辑：打开表浏览或可编辑自由 SQL（简单单表 SELECT）结果均可开启（Workspace 计算后传入）。 */
		editable?: boolean;
		/** B3.2 添加行独立于编辑模式（编辑目标存在即可添加，无需主键）。 */
		canAddRow?: boolean;
		/** B3.2 编辑按钮不可用时的原因（tooltip 展示）；null = 可用。 */
		editDisabledReason?: string | null;
		/** B3.2-R 自由 SQL 不可编辑查询的只读原因（非空时工具栏显示「只读结果」徽章 + 原因 tooltip）。 */
		readOnlyReason?: QueryEditabilityReason | null;
		/** B3.2-R 无主键/缺主键列定位警告（整行等值匹配生效时显示琥珀色徽章）。 */
		showKeylessWarning?: boolean;
		/** B3.2-R 刷新：重跑当前结果（打开表 reloadOpenTable / 自由 SQL rerun），自动刷新定时器复用。 */
		onRefresh?: () => void;
		/** B3.2 当前打开的表名（编辑提示/添加行时展示）。 */
		tableName?: string | null;
		/** B3.2 写操作失败的展示错误（Workspace 层执行写 SQL 后设置，网格底部提示）。 */
		writeError?: string | null;
		onDismissWriteError?: () => void;
		/** B3.2 单元格保存：Workspace 负责确认弹窗 + 执行写 SQL + 刷新。 */
		onSaveCell?: (input: { row: Record<string, string>; column: string; value: string }) => void;
		/** B3.2 新增行：Workspace 负责确认 + 执行 INSERT + 刷新。 */
		onAddRow?: (input: { values: Record<string, string> }) => void;
		/** B3.2 删除行：Workspace 负责确认 + 执行 DELETE + 刷新。 */
		onDeleteRow?: (input: { row: Record<string, string> }) => void;
	}

function CenterState({ icon, text, spin }: { icon: string; text: string; spin?: boolean }): JSX.Element {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
			{spin ? (
				<Spin />
			) : (
				<span className={cn("h-7 w-7 text-muted-foreground/50", icon)} />
			)}
			<p className="max-w-[360px] text-[12px] leading-relaxed text-muted-foreground">{text}</p>
		</div>
	);
}

/** 触发浏览器下载（V4-① 导出）。 */
function downloadTextFile(filename: string, content: string, mime: string): void {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

/**
 * 结果网格（B2.6 + V4）：列类型推断、单元格截断、行数 / 耗时 / 100 行上限提示；
 * V4-① 工具栏（导出 CSV/JSON + 复制）、V4-③ 列排序、V4-④ 长单元格详情对话框。
 */
	export function DatabaseResultGrid({
		status,
		result,
		connectionName,
		error,
		errorDetail,
		canGoNextPage = false,
		page = null,
		pageSize = null,
		loadingPage = false,
		onGoToPage,
		onAnalyzeResult,
		editable = false,
		canAddRow = false,
		editDisabledReason = null,
		readOnlyReason = null,
		showKeylessWarning = false,
		onRefresh,
		tableName = null,
		writeError = null,
		onDismissWriteError,
		onSaveCell,
		onAddRow,
		onDeleteRow,
}: DatabaseResultGridProps): JSX.Element {
	const { t } = useTranslation("settings");

	// B3.2-R 自动刷新：间隔秒数（null = 关闭）；onRefresh 经 ref 稳定，定时器只随间隔重建。
	const [autoRefreshSeconds, setAutoRefreshSeconds] = useState<number | null>(null);
	const onRefreshRef = useRef(onRefresh);
	useEffect(() => {
		onRefreshRef.current = onRefresh;
	}, [onRefresh]);
	useEffect(() => {
		if (!autoRefreshSeconds) return;
		const id = window.setInterval(() => onRefreshRef.current?.(), autoRefreshSeconds * 1000);
		return () => window.clearInterval(id);
	}, [autoRefreshSeconds]);

	// V4-③ 列排序：点击表头循环 未排序 → 升序 → 降序 → 未排序。
	const [sort, setSort] = useState<{ column: string; direction: SortDirection } | null>(null);
	// V4-④ 长单元格详情对话框：记录被点击的单元格（列 + 行 + 原始值）。
		const [detail, setDetail] = useState<{ column: string; rowIndex: number; value: string } | null>(null);
		// B3.2 编辑模式：仅 editable 时可用；开启后单元格可编辑、行可删除、可添加行。
		const [editMode, setEditMode] = useState(false);
		const [editingCell, setEditingCell] = useState<{ row: Record<string, string>; column: string; draft: string } | null>(null);
		const [addingRow, setAddingRow] = useState(false);
		const [rowDraft, setRowDraft] = useState<Record<string, string>>({});

	// B3.2 数据编辑：可用性变化时复位编辑态（按钮禁用/不可添加行时不残留编辑 UI）。
	useEffect(() => {
		if (!editable) setEditMode(false);
		if (!canAddRow) setAddingRow(false);
	}, [canAddRow, editable]);

	// 客户端分页（自由 SQL / AI 回填结果用）：作用于已加载结果集，新查询开始时回到第 1 页。
	// V6-② 打开表浏览改用服务端分页（page/pageSize props 由 workspace 注入），此处仅兜底自由 SQL。
	const [clientPage, setClientPage] = useState(1);
	const [clientPageSize, setClientPageSize] = useState(100);

	const columnKinds = useMemo<readonly ResultColumnKind[]>(() => {
		if (!result) return [];
		return result.columns.map((column) => inferColumnKind(result.rows.map((row) => row[column])));
	}, [result]);

	const sortedRows = useMemo(() => {
		if (!result || !sort) return result?.rows ?? [];
		return sortRows(result.rows, result.columns, sort.column, sort.direction, columnKinds);
	}, [result, sort, columnKinds]);

	// 新查询开始（status → running）时回到第 1 页；服务端翻页不触发（status 保持 success）。
	useEffect(() => {
		if (status === "running") setClientPage(1);
	}, [status]);

	// V6-② 服务端分页（打开表浏览）：page/pageSize/onGoToPage 由 workspace 注入时为服务端模式，
	// 结果网格只渲染当前页数据（每页 ≤ 100 行），翻页由 goToPage 重查；否则退回客户端分页（自由 SQL）。
	const serverPaged = page != null && pageSize != null && onGoToPage != null;

	// 服务端分页模式下用 props 注入的 page/pageSize；客户端分页用本地 state。
	const effectivePage = serverPaged ? (page ?? 1) : clientPage;
	const effectivePageSize = serverPaged ? (pageSize ?? 100) : clientPageSize;
	const totalRows = sortedRows.length;
	const totalPages = pageCount(totalRows, effectivePageSize);
	const safePage = clampPage(effectivePage, totalRows, effectivePageSize);
	const visibleRows = pageSlice(sortedRows, safePage, effectivePageSize);

	const exportCsv = () => {
		if (!result) return;
		recordSettingsUsage({ tab: "database", action: "selected", target: "result-export-csv" });
		downloadTextFile(exportFileName("csv"), rowsToCsv(result.columns, result.rows), "text/csv;charset=utf-8");
	};

	const exportJson = () => {
		if (!result) return;
		recordSettingsUsage({ tab: "database", action: "selected", target: "result-export-json" });
		downloadTextFile(exportFileName("json"), rowsToJson(result.columns, result.rows), "application/json;charset=utf-8");
	};

	const copyResult = () => {
		if (!result) return;
		recordSettingsUsage({ tab: "database", action: "selected", target: "result-copy" });
		void navigator.clipboard.writeText(rowsToTsv(result.columns, result.rows)).catch(() => {});
	};

	const copyDetail = () => {
		if (!detail) return;
		recordSettingsUsage({ tab: "database", action: "selected", target: "cell-detail-copy" });
		void navigator.clipboard.writeText(detail.value).catch(() => {});
	};

	// B3.2 数据编辑：单元格编辑 / 添加行 / 删除行由 Workspace 层确认 + 执行写 SQL + 刷新。
	const startEdit = (row: Record<string, string>, column: string) => {
		if (!onSaveCell || !editMode) return;
		setEditingCell({ row, column, draft: row[column] ?? "" });
	};
	const commitCell = (row: Record<string, string>, column: string, draft: string) => {
		if (!onSaveCell) return;
		setEditingCell(null);
		onSaveCell({ row, column, value: draft });
	};
	const confirmAddRow = () => {
		if (!onAddRow || !result) return;
		setAddingRow(false);
		onAddRow({ values: rowDraft });
	};
	const beginAddRow = () => {
		if (!result || !canAddRow) return;
		setRowDraft(Object.fromEntries(result.columns.map((column) => [column, ""])));
		setAddingRow(true);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-muted/35">
			<div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-3">
				<DatabaseSectionLabel icon="icon-[mdi--table-large]">{t("databaseResult")}</DatabaseSectionLabel>
				{status === "success" && result ? (
					<div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
						<span className="truncate">{connectionName}</span>
						<span className="shrink-0">{t("databaseResultRows", { count: result.rowCount })}</span>
						{result.truncated ? (
							<span
								title={t("databaseResultTruncatedHint")}
								className="shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10.5px] text-amber-700 dark:text-amber-400"
							>
								{t("databaseResultTruncated")}
							</span>
						) : null}
						{result.durationMs ? <span className="shrink-0">{result.durationMs}</span> : null}
						{result.durationMs ? <span className="shrink-0">{result.durationMs}</span> : null}
						{/* B3.2-R 工具栏：只读/无主键徽章 + 刷新 + 自动刷新 + 添加行；对齐 dbx DataGridToolbar。 */}
						{readOnlyReason ? (
							<span
								title={t(`databaseEditReadOnlyReason.${readOnlyReason}` as `databaseEditReadOnlyReason.${QueryEditabilityReason}`)}
								className="shrink-0 rounded-full border border-border/60 bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground"
							>
								{t("databaseEditReadOnly")}
							</span>
						) : null}
						{showKeylessWarning ? (
							<span
								title={t("databaseEditNoPkWarning")}
								className="shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10.5px] text-amber-700 dark:text-amber-400"
							>
								{t("databaseEditKeylessWarning")}
							</span>
						) : null}
						{onRefresh ? (
							<Button
								variant="ghost"
								size="sm"
								className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
								aria-label={t("databaseRefresh")}
								title={t("databaseRefresh")}
								onClick={onRefresh}
							>
								<span className="icon-[mdi--refresh] h-3.5 w-3.5" />
							</Button>
						) : null}
						{onRefresh ? (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="sm"
										aria-pressed={autoRefreshSeconds !== null}
										aria-label={t("databaseAutoRefresh")}
										title={t("databaseAutoRefresh")}
										className={cn(
											"h-6 gap-1 px-1.5 text-[11px]",
											autoRefreshSeconds !== null ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
										)}
									>
										<span className="icon-[mdi--timer-outline] h-3.5 w-3.5" />
										{autoRefreshSeconds !== null ? `${autoRefreshSeconds}s` : t("databaseAutoRefreshShort")}
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-44">
									<DropdownMenuItem onClick={() => setAutoRefreshSeconds(autoRefreshSeconds !== null ? null : AUTO_REFRESH_DEFAULT_SECONDS)}>
										<span className="h-4 w-4" />
										{autoRefreshSeconds !== null ? t("databaseAutoRefreshStop") : t("databaseAutoRefreshStart")}
									</DropdownMenuItem>
									{AUTO_REFRESH_INTERVALS.map((seconds) => (
										<DropdownMenuItem key={seconds} onClick={() => setAutoRefreshSeconds(seconds)}>
											<span className={cn("h-4 w-4", autoRefreshSeconds === seconds ? "icon-[mdi--check]" : "")} />
											{t("databaseAutoRefreshEvery", { seconds })}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
						{canAddRow ? (
							<Button
								variant="ghost"
								size="sm"
								className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
								aria-label={t("databaseEditAddRow")}
								title={t("databaseEditAddRow")}
								disabled={addingRow}
								onClick={beginAddRow}
							>
								<span className="icon-[mdi--plus] h-3.5 w-3.5" />
								{t("databaseEditAddRow")}
							</Button>
						) : null}
						<span className="mx-1 h-3 w-px shrink-0 bg-border/60" />
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
									aria-label={t("databaseExport")}
									title={t("databaseExport")}
								>
									<span className="icon-[mdi--export] h-3.5 w-3.5" />
									{t("databaseExport")}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-40">
								<DropdownMenuItem onClick={exportCsv}>
									<span className="icon-[mdi--file-delimited-outline] h-4 w-4" />
									{t("databaseExportCsv")}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={exportJson}>
									<span className="icon-[mdi--code-json] h-4 w-4" />
									{t("databaseExportJson")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
							aria-label={t("databaseCopyResult")}
							title={t("databaseCopyResult")}
							onClick={copyResult}
						>
							<span className="icon-[mdi--content-copy] h-3.5 w-3.5" />
							{t("databaseCopyResult")}
						</Button>
						{onAnalyzeResult ? (
							<Button
								variant="ghost"
								size="sm"
								className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
								aria-label={t("databaseAnalyzeResult.label")}
								title={t("databaseAnalyzeResult.label")}
								onClick={onAnalyzeResult}
							>
								<span className="icon-[mdi--chat-question-outline] h-3.5 w-3.5" />
								{t("databaseAnalyzeResult.label")}
							</Button>
							) : null}
							<Button
								variant="ghost"
								size="sm"
								aria-pressed={editable && editMode}
								disabled={!editable}
								className={cn(
									"h-6 gap-1 px-1.5 text-[11px]",
									editable && editMode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
									!editable && "cursor-not-allowed",
								)}
								aria-label={t("databaseEditMode")}
								title={editable ? t("databaseEditMode") : (editDisabledReason ?? t("databaseEditMode"))}
								onClick={() => {
									if (!editable) return;
									setEditMode((current) => !current);
									setEditingCell(null);
									setAddingRow(false);
									recordSettingsUsage({ tab: "database", action: editMode ? "disabled" : "enabled", target: "data-edit-mode" });
								}}
							>
								<span className="icon-[mdi--pencil-outline] h-3.5 w-3.5" />
								{t("databaseEditMode")}
							</Button>
						</div>
					) : null}
			</div>

			{status === "idle" ? (
				<CenterState icon="icon-[mdi--table-large]" text={t("databaseResultIdle")} />
			) : status === "running" ? (
				<CenterState icon="" text={t("databaseRunning")} spin />
			) : status === "error" ? (
				<div className="px-4 pb-4">
					<DatabaseNotice tone="error" title={error ?? t("databaseQueryFailed")}>
						{errorDetail ? <DatabaseDetail>{errorDetail}</DatabaseDetail> : null}
					</DatabaseNotice>
					{onAnalyzeResult ? (
						<div className="mt-2 flex justify-end">
							<Button
								variant="ghost"
								size="sm"
								className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
								aria-label={t("databaseAnalyzeError.label")}
								title={t("databaseAnalyzeError.label")}
								onClick={onAnalyzeResult}
							>
								<span className="icon-[mdi--chat-question-outline] h-3.5 w-3.5" />
								{t("databaseAnalyzeError.label")}
							</Button>
						</div>
					) : null}
				</div>
			) : result && result.columns.length > 0 ? (
				<>
					<div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
						<table className="w-full border-separate border-spacing-0 text-[12px]">
							<thead className="sticky top-0 z-10">
								<tr>
									<th className="w-10 border-b border-border/40 bg-muted/95 px-2 py-1.5 text-right text-[10.5px] font-medium text-muted-foreground/70">
										#
									</th>
									{result.columns.map((column, index) => {
										const active = sort?.column === column;
										return (
											<th
												key={column}
												title={column}
												onClick={() => {
													const next = nextSortDirection(active ? sort.direction : null);
													setSort(next ? { column, direction: next } : null);
													recordSettingsUsage({ tab: "database", action: "selected", target: "result-sort" });
												}}
												className={cn(
													"max-w-[260px] cursor-pointer select-none truncate border-b border-border/40 bg-muted/95 px-2.5 py-1.5 text-[11px] font-semibold text-foreground",
													columnKinds[index] === "number" ? "text-right" : "text-left",
												)}
											>
												<span className="inline-flex items-center gap-1">
													{column}
													{active ? (
														<span
															className={cn(
																"h-3 w-3 shrink-0 text-muted-foreground",
																sort?.direction === "asc" ? "icon-[mdi--arrow-up]" : "icon-[mdi--arrow-down]",
															)}
														/>
													) : null}
												</span>
											</th>
										);
									})}
								</tr>
							</thead>
							<tbody>
								{visibleRows.map((row, rowIndex) => (
									<tr key={rowIndex} className="group">
										<td className="border-b border-border/25 px-2 py-1 text-right text-[10.5px] text-muted-foreground/60">
											<span className="inline-flex items-center gap-1">
												{(safePage - 1) * effectivePageSize + rowIndex + 1}
												{editMode && onDeleteRow ? (
													<button
														type="button"
														aria-label={t("databaseEditDeleteRow")}
														title={t("databaseEditDeleteRow")}
														onClick={() => onDeleteRow({ row })}
														className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
													>
														<span className="icon-[mdi--trash-can-outline] h-3.5 w-3.5" />
													</button>
												) : null}
											</span>
										</td>
										{result.columns.map((column, colIndex) => {
											const raw = row[column];
											const isNull = isNullCell(raw);
											const truncated = !isNull && raw.length > RESULT_CELL_MAX_CHARS;
											const editing = editMode && editingCell?.row === row && editingCell.column === column;
											if (editing) {
												return (
													<td key={column} className="border-b border-border/25 px-1 py-0.5">
														<input
															autoFocus
															value={editingCell.draft}
															aria-label={column}
															onChange={(event) => setEditingCell({ row, column, draft: event.target.value })}
															onKeyDown={(event) => {
																if (event.key === "Enter") commitCell(row, column, editingCell.draft);
																if (event.key === "Escape") setEditingCell(null);
															}}
															onBlur={() => commitCell(row, column, editingCell.draft)}
															className="h-7 w-full min-w-[88px] rounded-md border border-primary/50 bg-background px-2 text-[12px] text-foreground outline-none"
														/>
													</td>
												);
											}
											return (
												<td
													key={column}
													title={isNull ? undefined : raw}
													onClick={
														editMode && onSaveCell
															? () => startEdit(row, column)
															: truncated
																? () => {
																		setDetail({ column, rowIndex, value: raw });
																		recordSettingsUsage({ tab: "database", action: "selected", target: "cell-detail-open" });
																	}
																: undefined
													}
													className={cn(
														"max-w-[260px] truncate border-b border-border/25 px-2.5 py-1",
														columnKinds[colIndex] === "number" ? "text-right tabular-nums" : "text-left",
														isNull ? "italic text-muted-foreground/50" : "text-foreground",
														truncated && "cursor-pointer hover:bg-muted/60",
														editMode && onSaveCell && "cursor-text hover:bg-muted/50",
													)}
												>
													{isNull ? "NULL" : truncateCell(raw)}
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
					{canAddRow ? (
						<div className="shrink-0 border-t border-border/30 px-4 py-2">
							{addingRow ? (
								<div className="flex items-center gap-1.5 overflow-x-auto pb-1">
									{result.columns.map((column) => (
										<input
											key={column}
											value={rowDraft[column] ?? ""}
											placeholder={column}
											title={column}
											aria-label={column}
											onChange={(event) => setRowDraft((draft) => ({ ...draft, [column]: event.target.value }))}
											onKeyDown={(event) => {
												if (event.key === "Enter") confirmAddRow();
												if (event.key === "Escape") setAddingRow(false);
											}}
											className="h-6 w-28 shrink-0 rounded-md border border-border/60 bg-background px-2 text-[11px] text-foreground outline-none focus-visible:border-primary/50"
										/>
									))}
									<Button size="sm" className="h-6 shrink-0 gap-1 px-2 text-[11px]" onClick={confirmAddRow}>
										<span className="icon-[mdi--check] h-3.5 w-3.5" />
										{t("databaseEditSave")}
									</Button>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 shrink-0 gap-1 px-2 text-[11px] text-muted-foreground"
										onClick={() => setAddingRow(false)}
									>
										<span className="icon-[mdi--close] h-3.5 w-3.5" />
										{t("databaseEditCancel")}
									</Button>
								</div>
							) : (
								<div className="flex min-w-0 items-center justify-end gap-2">
									{editMode ? (
										<p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
											{t("databaseEditHint", { table: tableName ?? "" })}
										</p>
									) : null}
									<Button
										size="sm"
										variant="ghost"
										className="h-6 shrink-0 gap-1 px-2 text-[11px] text-muted-foreground"
										onClick={beginAddRow}
									>
										<span className="icon-[mdi--plus] h-3.5 w-3.5" />
										{t("databaseEditAddRow")}
									</Button>
								</div>
							)}
						</div>
					) : null}
					{writeError ? (
						<div className="shrink-0 border-t border-border/30 px-4 py-2">
							<DatabaseNotice tone="error" title={t("databaseEditFailed")}>
								<div className="flex items-start justify-between gap-2">
									<DatabaseDetail>{writeError}</DatabaseDetail>
									<button
										type="button"
										aria-label={t("databaseEditCancel")}
										title={t("databaseEditCancel")}
										onClick={onDismissWriteError}
										className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
									>
										<span className="icon-[mdi--close] h-3.5 w-3.5" />
									</button>
								</div>
							</DatabaseNotice>
						</div>
					) : null}
					</div>
					{(totalPages > 1 || canGoNextPage) && (
						<div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/30 px-4 py-1.5">
							<div className="flex min-w-0 items-center gap-2">
								{serverPaged ? (
									<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
										{t("databasePageInfo", { page: page ?? 1, pageSize: pageSize ?? 100 })}
									</span>
								) : totalPages > 1 ? (
									<>
										<select
											value={clientPageSize}
											onChange={(event) => {
												setClientPageSize(Number(event.target.value));
												setClientPage(1);
												recordSettingsUsage({ tab: "database", action: "selected", target: "result-page-size" });
											}}
											aria-label={t("databasePageSize")}
											title={t("databasePageSize")}
											className="h-6 shrink-0 rounded-md border border-border/60 bg-background px-1 text-[11px] text-muted-foreground outline-none focus-visible:border-primary/50"
										>
											{[50, 100, 200, 500].map((size) => (
												<option key={size} value={size}>
													{size}
												</option>
											))}
										</select>
										<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
											{t("databasePagination", { page: safePage, total: totalPages })}
										</span>
									</>
								) : null}
							</div>
							<div className="flex shrink-0 items-center gap-1">
								{serverPaged ? (
									<>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 px-0 text-[11px] text-muted-foreground"
											aria-label={t("databasePaginationPrev")}
											title={t("databasePaginationPrev")}
											disabled={loadingPage || (page ?? 1) <= 1}
											onClick={() => {
												onGoToPage((page ?? 1) - 1);
												recordSettingsUsage({ tab: "database", action: "selected", target: "result-page-prev" });
											}}
										>
											<span className="icon-[mdi--chevron-left] h-3.5 w-3.5" />
										</Button>
										{loadingPage ? <Spin size="sm" /> : null}
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 px-0 text-[11px] text-muted-foreground"
											aria-label={t("databasePaginationNext")}
											title={t("databasePaginationNext")}
											disabled={loadingPage || !canGoNextPage}
											onClick={() => {
												onGoToPage((page ?? 1) + 1);
												recordSettingsUsage({ tab: "database", action: "selected", target: "result-page-next" });
											}}
										>
											<span className="icon-[mdi--chevron-right] h-3.5 w-3.5" />
										</Button>
									</>
								) : totalPages > 1 ? (
									<>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 px-0 text-[11px] text-muted-foreground"
											aria-label={t("databasePaginationPrev")}
											title={t("databasePaginationPrev")}
											disabled={safePage <= 1}
											onClick={() => {
												setClientPage(safePage - 1);
												recordSettingsUsage({ tab: "database", action: "selected", target: "result-page-prev" });
											}}
										>
											<span className="icon-[mdi--chevron-left] h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 px-0 text-[11px] text-muted-foreground"
											aria-label={t("databasePaginationNext")}
											title={t("databasePaginationNext")}
											disabled={safePage >= totalPages}
											onClick={() => {
												setClientPage(safePage + 1);
												recordSettingsUsage({ tab: "database", action: "selected", target: "result-page-next" });
											}}
										>
											<span className="icon-[mdi--chevron-right] h-3.5 w-3.5" />
										</Button>
									</>
								) : null}
							</div>
						</div>
					)}
				</>
			) : (
				<CenterState icon="icon-[mdi--table-off]" text={t("databaseResultIdle")} />
			)}

			{/* V4-④ 长单元格详情对话框：截断单元格点击查看全文 + 复制。 */}
			<Dialog open={detail !== null} onOpenChange={(next) => (next ? undefined : setDetail(null))}>
				<DialogContent className="max-w-[min(44rem,calc(100%-2rem))]">
					<DialogHeader>
						<DialogTitle>{t("databaseCellDetail")}</DialogTitle>
						<DialogDescription>
							{t("databaseCellDetailDesc", { column: detail?.column ?? "", row: (detail?.rowIndex ?? 0) + 1 })}
						</DialogDescription>
					</DialogHeader>
					<div className="max-h-[min(24rem,60dvh)] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/40 bg-muted/40 p-3 font-mono text-[12px] leading-relaxed text-foreground">
						{detail?.value ?? ""}
					</div>
					<DialogFooter>
						<Button variant="primary" size="sm" onClick={copyDetail}>
							<span className="icon-[mdi--content-copy] h-3.5 w-3.5" />
							{t("databaseCopyValue")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
