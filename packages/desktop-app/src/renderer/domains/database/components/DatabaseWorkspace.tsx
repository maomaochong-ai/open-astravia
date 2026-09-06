import type { JSX, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Button,
	cn,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@astravia/ui";
import { ResizeHandle } from "@astravia/theme-ui";
import { useAtomValue, useSetAtom } from "jotai";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { i18n } from "@shared/i18n";
import { TabBar } from "@shared/components/ui/tab-bar";
import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { activityPanelWidthAtom, confirmDialogAtom } from "@shared/store/atoms";
import type { DatabaseSqlAction, DatabaseTabTarget } from "@shared/store/atoms";
import { DatabaseConnectionDetailsWorkbench } from "./DatabaseConnectionDetailsWorkbench";
import { DatabaseConnectionForm } from "./DatabaseConnectionForm";
import { DatabaseDetail } from "./DatabaseDetail";
import {
	DatabaseExplorerTree,
	type DatabaseRevealTarget,
	type TableBatchCommand,
	type TableBatchTarget,
	tableSelectionKey,
	type TableCommand,
} from "./DatabaseExplorerTree";
import {
	buildDangerOpSql,
	buildExportSelectSql,
	exportFileName,
	toCsv,
	toJson,
	type TableDangerOp,
	type TableTarget,
} from "../lib/table-ops";
import {
	DatabaseExplorerContextMenu,
	type DatabaseContextMenuItem,
} from "./DatabaseExplorerContextMenu";
import { DatabaseQueryHistoryPopover } from "./DatabaseQueryHistoryPopover";
import type { QueryHistoryEntry } from "../lib/query-history";
import { DatabaseListHeader } from "./DatabaseListHeader";
import { DatabaseNotice } from "./DatabaseNotice";
import { DatabaseQueryPanel } from "./DatabaseQueryPanel";
import { DatabaseResultGrid } from "./DatabaseResultGrid";
import { DatabaseSectionLabel } from "./DatabaseSectionLabel";
import { DatabaseStatusPill } from "./DatabaseStatus";
import { DatabaseTypeBadge } from "./DatabaseTypeBadge";
import { DatabaseWorkspaceHeader } from "./DatabaseWorkspaceHeader";
import { SettingsAiAssist } from "../../settings/ai-assist";
import { recordSettingsUsage } from "../../settings/components/recordSettingsUsage";
import { catalogFamilyOfType, scopeToTableScope, tableScopeQualifier } from "../lib/catalog-family";
import { formatAnchorTableSchema } from "../lib/ai-anchor";
import { describeTable, executeQuery, getSchemaContext } from "../lib/database-api";
import { formatDatabaseError } from "../lib/database-error-labels";
import { buildDeleteSql, buildInsertSql, buildOpenTableSql, buildRowWhere, buildUpdateSql } from "../lib/sql-dialect";
import { analyzeEditableQuery, type EditableQueryAnalysis } from "../lib/sql-editability";
import { resolveDatabaseLayout } from "../lib/database-layout";
import { useDatabaseAnalyzeResult } from "../hooks/useDatabaseAnalyzeResult";
import { useDatabaseAnalyzeSql } from "../hooks/useDatabaseAnalyzeSql";
import { useDatabaseAnalyzeTable } from "../hooks/useDatabaseAnalyzeTable";
import { useDatabaseExplorerModel } from "../hooks/useDatabaseExplorerModel";
import { useDatabaseQueryModel } from "../hooks/useDatabaseQueryModel";
import { useDatabaseWorkspaceModel } from "../hooks/useDatabaseWorkspaceModel";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const TREE_WIDTH_DEFAULT = 280;
const TREE_WIDTH_MIN = 200;
const TREE_WIDTH_MAX = 380;

const USER_GROUPS_KEY = "astravia:database:user-groups";

/**
 * 三栏经典数据库工具界面（B2.6-R 后挂载于活动面板「数据库」标签页，数据工作台）：
 * 左栏 连接→表→列 懒加载树；中栏 SQL 查询面板 + 结果网格；右栏 连接详情。
 *
 * 头部（B2.6-U U1）：活动面板 tab 栏已承载「数据库」label 与图标，页面内不再重复大标题，
 * 改为紧凑工具条 —— 左侧当前连接上下文（类型/名称/状态），右侧 icon-only 操作组。
 *
 * 自适应（B2.6-R 优化）：面板宽度可拖到 260px 起，三栏固定 280+320px 会溢出，
 * 因此按宽度分档降级 —— wide 三栏 inline / medium 两栏 + 详情浮层 / narrow 单栏 + 树与详情浮层，
 * 窄面板下树/详情通过 header 按钮以覆盖抽屉打开，中栏始终完整可用。
 */
interface DatabaseWorkspaceProps {
	/** 对话→界面（B2.7）：激活活动面板数据库标签页时自动选中并打开该连接/表。 */
	initialConnection?: string;
	initialTable?: string;
	/** B2.9-W1：AI 对话中 dbx_execute_query 成功的一次性同步目标（SQL/结果回填）。 */
	syncTarget?: DatabaseTabTarget | null;
	/** B2.9-W1/V6-①：工作台消费完 syncTarget（或确认无法消费）后通知上层清空 atom，
	 *  避免「挂载即清空」竞态丢回填，也避免无法消费时 atom 残留导致下次重复跳转。 */
	onSyncTargetApplied?: () => void;
	/** P1：chat SQL 块动作（pendingDatabaseSqlActionAtom，一次性）——「在新查询打开/执行」。 */
	sqlAction?: DatabaseSqlAction | null;
	/** P1：工作台消费完 sqlAction（或确认无法消费）后通知上层清空 atom，防残留重复触发。 */
	onSqlActionApplied?: () => void;

}

export function DatabaseWorkspace({
	initialConnection,
	initialTable,
	syncTarget,
	onSyncTargetApplied,
	sqlAction,
	onSqlActionApplied,

}: DatabaseWorkspaceProps): JSX.Element {
	const { t } = useTranslation("settings");
	const model = useDatabaseWorkspaceModel();
	const analyzeTable = useDatabaseAnalyzeTable();
	const analyzeResult = useDatabaseAnalyzeResult();
	const query = useDatabaseQueryModel();
	// P2 界面→对话：编辑器「问 AI」/历史「AI 分析」两个 SQL 锚点入口（见 useDatabaseAnalyzeSql）。
	const analyzeEditorSql = useDatabaseAnalyzeSql("editor");
	const analyzeHistorySql = useDatabaseAnalyzeSql("history");
	// B2.9-W1 反向：结果网格「让 AI 解读此查询」需要当前 SQL + 结果。提取 const 局部变量，
	// 闭包内捕获 const 局部变量可保留 TS 收窄（直接读 query.result / 对象属性会丢失收窄）。
	const lastResult = query.result;
	const lastResultSql = query.resultSql;
	// B3.2 数据编辑：结果列名（无主键时退化为整行等值匹配定位）。const 局部变量保留 TS 收窄。
	const lastResultColumns = query.result?.columns ?? [];
	// B3.2-R 自由 SQL 可编辑性：仅简单单表 SELECT 结果可回写（对齐 dbx sql_editability）。
	const editability = useMemo<EditableQueryAnalysis>(
		() => (lastResultSql ? analyzeEditableQuery(lastResultSql) : { editable: false, reason: "not-select" }),
		[lastResultSql],
	);
	const explorer = useDatabaseExplorerModel();
	// 顶栏动作（对齐 dbx AppSidebar 工具按钮组，h-5 w-5 / 12px）：全部折叠 / 全部刷新 / 新建分组（顶部「+」）。
	// dbx 常态无「全部展开」键（展开走树节点），故不提供；导入导出、收起侧栏因能力缺失不加。
	// V6-④ 用户自定义分组：仅组名持久化本地（dbx-mcp 连接自身分组原样保留，不写回数据面）。
	const handleCollapseAllConnections = () => {
		const names = model.connections.map((connection) => connection.name);
		if (names.length === 0) return;
		explorer.actions.collapseConnections(names);
		recordSettingsUsage({ tab: "database", action: "selected", target: "explorer-collapse-all" });
	};
	const handleRefreshAllConnections = () => {
		for (const connection of model.connections) {
			const family = catalogFamilyOfType(connection.type);
			if (family === "flat") explorer.actions.reloadTables(connection.name);
			else explorer.actions.reloadScopes(connection.name, family);
		}
		recordSettingsUsage({ tab: "database", action: "selected", target: "explorer-refresh-all" });
	};
	const [userGroups, setUserGroups] = useState<string[]>(() => {
		try {
			const raw = localStorage.getItem(USER_GROUPS_KEY);
			return raw ? (JSON.parse(raw) as string[]) : [];
		} catch {
			return [];
		}
	});
	const [groupDialogOpen, setGroupDialogOpen] = useState(false);
	const handleDeleteUserGroup = (group: string) => {
		const next = userGroups.filter((item) => item !== group);
		setUserGroups(next);
		try {
			localStorage.setItem(USER_GROUPS_KEY, JSON.stringify(next));
		} catch {
			// localStorage 不可用时仅内存态有效
		}
	};
	const [groupName, setGroupName] = useState("");
	const openGroupDialog = () => setGroupDialogOpen(true);
	const createUserGroup = () => {
		const name = groupName.trim();
		if (!name || userGroups.includes(name)) return;
		const next = [...userGroups, name];
		setUserGroups(next);
		try {
			localStorage.setItem(USER_GROUPS_KEY, JSON.stringify(next));
		} catch {
			// localStorage 不可用时仅内存态有效，不阻断建组
		}
		setGroupName("");
		setGroupDialogOpen(false);
	};
	const createGroupDialog = (
		<Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
			<DialogContent className="w-[300px]">
				<DialogHeader>
					<DialogTitle>{t("databaseCreateGroup")}</DialogTitle>
				</DialogHeader>
				<input
					value={groupName}
					autoFocus
					placeholder={t("databaseGroupNamePlaceholder")}
					onChange={(event) => setGroupName(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") createUserGroup();
					}}
					className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60"
				/>
				<DialogFooter>
					<Button variant="ghost" size="sm" onClick={() => setGroupDialogOpen(false)}>
						{t("databaseCancel")}
					</Button>
					<Button variant="primary" size="sm" onClick={createUserGroup} disabled={!groupName.trim()}>
						{t("databaseGroupCreateBtn")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
	const selected = model.selected;
	const activeTabConnectionName = query.activeTabConnectionName;
	// V7-② 查询执行上下文：优先取激活标签绑定的连接(tab 新建/打开表/AI 回填时锁定,对齐 dbx「tab 自带连接」),未绑定才回退当前选中连接。
	// 语义:一个标签 = 属于某个连接的独立工作单元;切树选择不再改变已开标签的运行目标,避免多连接下把 SQL 打到错误库。
	const effectiveConnection = useMemo(
		() => model.connections.find((connection) => connection.name === activeTabConnectionName) ?? selected,
		[model.connections, activeTabConnectionName, selected],
	);
	const setConfirm = useSetAtom(confirmDialogAtom);
	// B3.2 数据编辑：当前打开表的主键列（行级定位）；无主键则禁用编辑（安全默认）。
	const openTableMeta = query.openTableMeta;
	// B3.2-R 编辑目标：打开表 → openTableMeta；自由 SQL → 可编辑性分析通过的单表来源（方言类型用连接类型）。
	const editTarget = useMemo(
		() =>
			openTableMeta ??
			(editability.editable && effectiveConnection
				? { type: effectiveConnection.type, table: editability.info.table, scope: null }
				: null),
		[editability, openTableMeta, effectiveConnection],
	);

	// V6-③ 定位当前表：打开表的 tab(openTableMeta)存在时，向树下发定位目标。
	// 连接名取该 tab 实际执行连接(activeTabConnectionName/resultConnectionName，tab 打开表即绑定该连接)，与树当前选择无关。
	const revealTarget = useMemo((): DatabaseRevealTarget | null => {
		if (!openTableMeta) return null;
		const connection = query.activeTabConnectionName ?? query.resultConnectionName ?? null;
		if (!connection) return null;
		const scopeName = tableScopeQualifier(openTableMeta.scope) ?? null;
		return { connection, table: openTableMeta.table, scope: scopeName };
	}, [openTableMeta, query.activeTabConnectionName, query.resultConnectionName]);
	const [pkColumns, setPkColumns] = useState<string[]>([]);
	// B3.2-R 表结构读取状态：loading（describeTable 在飞）/ ready / failed（读取失败需暴露原因，不静默）。
	const [pkState, setPkState] = useState<"loading" | "ready" | "failed">("loading");
	const [writeError, setWriteError] = useState<string | null>(null);

	// 主键加载：编辑目标（打开表或可编辑自由 SQL 的来源表）结果就绪时读取表结构，供单元格编辑/删除行定位 WHERE。
	useEffect(() => {
		if (!effectiveConnection || !editTarget || query.status !== "success") {
			setPkColumns([]);
			setPkState("loading");
			return;
		}
		let cancelled = false;
		setPkState("loading");
		void describeTable(effectiveConnection.name, editTarget.table, editTarget.scope ?? undefined)
			.then((columns) => {
				if (!cancelled) {
					setPkColumns(columns.filter((column) => column.isPrimaryKey).map((column) => column.name));
					setPkState("ready");
				}
			})
			.catch(() => {
				if (!cancelled) {
					setPkColumns([]);
					setPkState("failed");
				}
			});
		return () => {
			cancelled = true;
		};
	}, [editTarget, query.status, effectiveConnection]);

	// B3.2 写操作执行：确认后执行写 SQL（main 侧仍有 prod 写保护兜底）→ 成功刷新（打开表 reloadOpenTable / 自由 SQL rerun 不推历史）；失败在网格底部展示。
	const runWrite = useCallback(
		async (sql: string) => {
			if (!effectiveConnection) return;
			try {
				// 数据编辑（保存单元格/加行/删行）前已弹确认对话框，此处 confirmedWrite 放行写/DDL。
				await executeQuery(effectiveConnection.name, sql, { confirmedWrite: true, confirmedSql: sql });
				setWriteError(null);
				if (query.openTableMeta) {
					await query.actions.reloadOpenTable(effectiveConnection);
				} else if (query.resultSql) {
					await query.actions.rerun(effectiveConnection, query.resultSql);
				}
			} catch (caught) {
				const { message, detail } = formatDatabaseError(t, caught);
				setWriteError(detail || message);
			}
		},
		[query.actions, query.openTableMeta, query.resultSql, effectiveConnection, t],
	);

	const handleSaveCell = useCallback(
		({ row, column, value }: { row: Record<string, string>; column: string; value: string }) => {
			if (!editTarget) return;
			const where = buildRowWhere(row, pkColumns, lastResultColumns);
			const hasPk = pkColumns.some((pk) => pk in row);
			const sql = buildUpdateSql(editTarget.type, editTarget.table, [{ column, value }], where, tableScopeQualifier(editTarget.scope));
			setConfirm({
				title: t("databaseEditConfirm"),
				message:
					t("databaseEditConfirmMessage", { sql }) +
					(hasPk ? "" : `\n\n${t("databaseEditNoPkWarning")}`),
				confirmLabel: t("databaseEditSave"),
				onConfirm: () => {
					recordSettingsUsage({ tab: "database", action: "changed", target: "data-edit-cell" });
					void runWrite(sql);
				},
			});
		},
		[lastResultColumns, editTarget, pkColumns, runWrite, setConfirm, t],
	);

	const handleAddRow = useCallback(
		({ values }: { values: Record<string, string> }) => {
			if (!editTarget) return;
			const sql = buildInsertSql(
				editTarget.type,
				editTarget.table,
				Object.keys(values).map((column) => ({ column, value: values[column] })),
				tableScopeQualifier(editTarget.scope),
			);
			setConfirm({
				title: t("databaseEditConfirmAddRow"),
				message: t("databaseEditConfirmMessage", { sql }),
				confirmLabel: t("databaseEditSave"),
				onConfirm: () => {
					recordSettingsUsage({ tab: "database", action: "changed", target: "data-edit-add-row" });
					void runWrite(sql);
				},
			});
		},
		[editTarget, runWrite, setConfirm, t],
	);

	const handleDeleteRow = useCallback(
		({ row }: { row: Record<string, string> }) => {
			if (!editTarget) return;
			const where = buildRowWhere(row, pkColumns, lastResultColumns);
			const hasPk = pkColumns.some((pk) => pk in row);
			const sql = buildDeleteSql(editTarget.type, editTarget.table, where, tableScopeQualifier(editTarget.scope));
			setConfirm({
				title: t("databaseEditConfirmDeleteRow"),
				message:
					t("databaseEditConfirmMessage", { sql }) +
					(hasPk ? "" : `\n\n${t("databaseEditNoPkWarning")}`),
				confirmLabel: t("databaseEditDeleteRow"),
				variant: "danger",
				onConfirm: () => {
					recordSettingsUsage({ tab: "database", action: "changed", target: "data-edit-delete-row" });
					void runWrite(sql);
				},
			});
		},
		[lastResultColumns, editTarget, pkColumns, runWrite, setConfirm, t],
	);

	// === 批次3 #6 表级套件：导出(CSV/JSON)、清空/删除/重命名，危险写全部经 confirmed-binding 确认通道 ===
	const tableTargetFromCommand = (command: TableCommand): TableTarget => ({
		dbType: command.connection.type,
		table: command.table.name,
		schema: command.scope ? tableScopeQualifier(scopeToTableScope(command.scope)) : undefined,
	});

	const [renameState, setRenameState] = useState<{ target: TableCommand; value: string } | null>(null);
	const closeRenameDialog = () => setRenameState(null);

	// 危险写：confirmed-binding 通道放行 → 成功后刷树（结构变化）→ truncate 且打开的是该表时刷新结果格。
	const runTableDangerOp = useCallback(
		async (op: TableDangerOp, command: TableCommand, sql: string) => {
			try {
				await executeQuery(command.connection.name, sql, { confirmedWrite: true, confirmedSql: sql });
				setWriteError(null);
				const family = catalogFamilyOfType(command.connection.type);
				if (family === "flat") await explorer.actions.reloadTables(command.connection.name);
				else await explorer.actions.reloadScopes(command.connection.name, family);
				const meta = query.openTableMeta;
				if (op === "truncate" && meta && meta.connectionName === command.connection.name && meta.table === command.table.name) {
					await query.actions.reloadOpenTable(command.connection).catch(() => {});
				}
			} catch (caught) {
				const { message, detail } = formatDatabaseError(t, caught);
				setWriteError(detail || message);
			}
		},
		[explorer.actions, query.actions, query.openTableMeta, t],
	);

	// 导出当前表（前 N 行）→ CSV/JSON → 原生保存对话框；取消/失败留痕于 writeError。
	const handleExportTable = useCallback(
		async (command: TableCommand, ext: "csv" | "json") => {
			try {
				const result = await executeQuery(command.connection.name, buildExportSelectSql(tableTargetFromCommand(command)));
				const text = ext === "csv" ? toCsv(result) : toJson(result);
				const saved = await window.astravia.dialog.saveData(exportFileName(command.table.name, ext), text, "utf8", {
					filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
				});
				if (saved) setWriteError(null);
			} catch (caught) {
				const { message, detail } = formatDatabaseError(t, caught);
				setWriteError(detail || message);
			}
		},
		[t, tableTargetFromCommand],
	);

	// 树右键命令分发：truncate/drop 走确认弹窗（展示将执行的 SQL），rename 弹新表名输入，导出直接落盘。
	const handleTableCommand = useCallback(
		(command: TableCommand) => {
			switch (command.kind) {
				case "exportCsv":
					void handleExportTable(command, "csv");
					break;
				case "exportJson":
					void handleExportTable(command, "json");
					break;
				case "truncate":
				case "drop": {
					const sql = buildDangerOpSql(tableTargetFromCommand(command), command.kind);
					setConfirm({
						title: t("databaseTableDangerTitle"),
						message: t("databaseTableDangerMessage", { sql }),
						confirmLabel: t(command.kind === "truncate" ? "databaseTruncateTable" : "databaseDropTable"),
						variant: "danger",
						onConfirm: () => {
							recordSettingsUsage({ tab: "database", action: "changed", target: command.kind === "truncate" ? "table-truncate" : "table-drop" });
							void runTableDangerOp(command.kind, command, sql);
						},
					});
					break;
				}
				case "rename":
					setRenameState({ target: command, value: "" });
					break;
			}
		},
		[handleExportTable, runTableDangerOp, setConfirm, tableTargetFromCommand, t],
	);

	const submitRename = () => {
		if (!renameState) return;
		const name = renameState.value.trim();
		if (!name) return;
		const sql = buildDangerOpSql(tableTargetFromCommand(renameState.target), "rename", name);
		const command = renameState.target;
		setRenameState(null);
		recordSettingsUsage({ tab: "database", action: "changed", target: "table-rename" });
		void runTableDangerOp("rename", command, sql);
	};

	// === 批次3 #16 批量表套件(对齐 dbx 对象浏览器):树内勾选多表 → 汇总确认 → 逐表 confirmed 执行 → 汇总反馈 ===
	const [tableBatchResetNonce, setTableBatchResetNonce] = useState(0);
	const [tableBatchKeepKeys, setTableBatchKeepKeys] = useState<readonly string[]>([]);
	const [tableBatchBusy, setTableBatchBusy] = useState(false);
	const [tableBatchResult, setTableBatchResult] = useState<{
		op: "truncate" | "drop";
		ok: number;
		failed: { target: TableBatchTarget; reason: string }[];
	} | null>(null);
	const closeBatchResult = () => setTableBatchResult(null);

	const tableTargetFromBatchTarget = (target: TableBatchTarget): TableTarget => ({
		dbType: target.connection.type,
		table: target.table,
		schema: target.scope ? tableScopeQualifier(scopeToTableScope(target.scope)) : undefined,
	});

	const runBatchDangerOp = useCallback(
		async (op: "truncate" | "drop", targets: readonly TableBatchTarget[]) => {
			if (tableBatchBusy || targets.length === 0) {
				return;
			}
			setTableBatchBusy(true);
			setTableBatchResult(null);
			recordSettingsUsage({
				tab: "database",
				action: "changed",
				target: op === "truncate" ? "table-batch-truncate" : "table-batch-drop",
			});
			const ok: TableBatchTarget[] = [];
			const failed: { target: TableBatchTarget; reason: string }[] = [];
			for (const target of targets) {
				try {
					const sql = buildDangerOpSql(tableTargetFromBatchTarget(target), op);
					await executeQuery(target.connection.name, sql, { confirmedWrite: true, confirmedSql: sql });
					ok.push(target);
				} catch (caught) {
					const { message, detail } = formatDatabaseError(t, caught);
					failed.push({ target, reason: detail || message });
				}
			}
			// 一致性(对齐 dbx):truncate 刷新该表数据页;drop 关闭正在打开的该表页;每个成功连接只刷一次树。
			const refreshed = new Set<string>();
			for (const target of ok) {
				if (!refreshed.has(target.connection.name)) {
					refreshed.add(target.connection.name);
					const family = catalogFamilyOfType(target.connection.type);
					if (family === "flat") {
						void explorer.actions.reloadTables(target.connection.name);
					} else {
						void explorer.actions.reloadScopes(target.connection.name, family);
					}
				}
				const meta = query.openTableMeta;
				if (!meta || meta.connectionName !== target.connection.name || meta.table !== target.table) {
					continue;
				}
				if (op === "truncate") {
					await query.actions.reloadOpenTable(target.connection).catch(() => {});
				} else if (query.activeTabId) {
					query.actions.closeTab(query.activeTabId);
				}
			}
			setTableBatchResult({ op, ok: ok.length, failed });
			// 失败项保留勾选便于重试;成功后由树侧非自增清空(仅清除成功项)。
			setTableBatchKeepKeys(failed.map((item) => tableSelectionKey(item.target.connection, item.target.table, item.target.scope)));
			setTableBatchResetNonce((nonce) => nonce + 1);
			setTableBatchBusy(false);
		},
		[explorer.actions, query.activeTabId, query.actions, query.openTableMeta, tableBatchBusy, t],
	);

	const runBatchExport = useCallback(
		async (targets: readonly TableBatchTarget[], ext: "csv" | "json") => {
			for (const target of targets) {
				try {
					const result = await executeQuery(target.connection.name, buildExportSelectSql(tableTargetFromBatchTarget(target)));
					const text = ext === "csv" ? toCsv(result) : toJson(result);
					const saved = await window.astravia.dialog.saveData(exportFileName(target.table, ext), text, "utf8", {
						filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
					});
					if (!saved) {
						return; // 用户取消:中断后续保存,已完成文件保留
					}
				} catch (caught) {
					const { message, detail } = formatDatabaseError(t, caught);
					setWriteError(detail || message);
					return; // 失败即停:避免连续弹错,已完成文件保留
				}
			}
			setWriteError(null);
		},
		[t],
	);

	const handleTableBatchCommand = useCallback(
		(command: TableBatchCommand) => {
			if (command.action === "exportCsv" || command.action === "exportJson") {
				void runBatchExport(command.targets, command.action === "exportCsv" ? "csv" : "json");
				return;
			}
			const op: "truncate" | "drop" = command.action;
			const preview = command.targets
				.map((target) => buildDangerOpSql(tableTargetFromBatchTarget(target), op))
				.slice(0, 3)
				.join("\n");
			const remaining = command.targets.length - 3;
			setConfirm({
				title: t(op === "truncate" ? "databaseBatchTruncateTitle" : "databaseBatchDropTitle"),
				message:
					t("databaseBatchDangerMessage", {
						count: command.targets.length,
						action: t(op === "truncate" ? "databaseTruncateTable" : "databaseDropTable"),
					}) + `\n\n${preview}` + (remaining > 0 ? `\n${t("databaseBatchMoreCount", { count: remaining })}` : ""),
				confirmLabel: t(op === "truncate" ? "databaseTableBatchTruncate" : "databaseTableBatchDrop"),
				variant: "danger",
				onConfirm: () => {
					void runBatchDangerOp(op, command.targets);
				},
			});
		},
		[runBatchDangerOp, runBatchExport, setConfirm, t],
	);

	const tableBatchResultBanner = tableBatchResult ? (
		<div
			className={cn(
				"relative mb-1.5 rounded-md border px-2.5 py-2 text-[12px] leading-relaxed",
				tableBatchResult.failed.length === 0
					? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
					: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
			)}
		>
			<button
				type="button"
				aria-label={t("databaseClose")}
				title={t("databaseClose")}
				className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded opacity-70 hover:bg-background/60"
				onClick={closeBatchResult}
			>
				<span className="h-3.5 w-3.5 icon-[mdi--close]" />
			</button>
			<div className="pr-6 font-medium">
				{tableBatchResult.failed.length === 0
					? t(
							tableBatchResult.op === "truncate" ? "databaseBatchResultOkTruncate" : "databaseBatchResultOkDrop",
							{ count: tableBatchResult.ok },
						)
					: tableBatchResult.ok > 0
						? t("databaseBatchResultPartial", { ok: tableBatchResult.ok, failed: tableBatchResult.failed.length })
						: t("databaseBatchResultAllFailed", { count: tableBatchResult.failed.length })}
			</div>
			{tableBatchResult.failed.length > 0 ? (
				<ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto font-mono text-[11px] opacity-90">
					{tableBatchResult.failed.map((item) => (
						<li key={tableSelectionKey(item.target.connection, item.target.table, item.target.scope)}>
							{item.target.table}: {item.reason}
						</li>
					))}
				</ul>
			) : null}
		</div>
	) : null;

	const tableDialogs = (
		<Dialog open={renameState !== null} onOpenChange={(open) => { if (!open) closeRenameDialog(); }}>
			<DialogContent className="w-[380px]">
				<DialogHeader>
					<DialogTitle>{t("databaseRenameTable")}</DialogTitle>
				</DialogHeader>
				<input
					value={renameState?.value ?? ""}
					autoFocus
					placeholder={t("databaseTableRenamePlaceholder")}
					onChange={(event) => setRenameState((state) => (state ? { ...state, value: event.target.value } : state))}
					onKeyDown={(event) => { if (event.key === "Enter") submitRename(); }}
					className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60"
				/>
				<DialogFooter>
					<Button variant="ghost" size="sm" onClick={closeRenameDialog}>
						{t("databaseCancel")}
					</Button>
					<Button variant="primary" size="sm" onClick={submitRename} disabled={!renameState?.value.trim()}>
						{t("databaseTableRenameAction")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);

	// B2.6-W 反馈 3：工作台「问数」入口 —— 复用 SettingsAiAssist 弹层形态，提交时把
	// 当前连接的 schema 摘要注入 agent instruction（模型可见、用户气泡不可见）。
	// P0（ADR 决策项 1/2）：工作台「问数」入口提交时，优先注入「打开的表」锚点级表结构
	// （openTableMeta → describeTable → formatAnchorTableSchema，列结构优先于整连接摘要）；
	// 无打开表 / 表结构读取失败时回退连接级 schema 摘要（原 B2.6 行为，不退化）。
	const askExtraInstruction = useCallback(async () => {
		if (!effectiveConnection && !openTableMeta) return "";
		// B2.9-W3 埋点：工作台「问数」入口提交(含当前执行连接 schema 注入)。
		recordSettingsUsage({ tab: "database", action: "selected", target: "ask-data" });
		// 锚点连接优先取打开表 tab 绑定的执行连接（与 describeTable 同库），否则取当前执行连接。
		const anchorConnection = openTableMeta?.connectionName ?? effectiveConnection?.name;
		if (!anchorConnection) return "";
		let schema = "";
		if (openTableMeta) {
			try {
				const columns = await describeTable(
					anchorConnection,
					openTableMeta.table,
					openTableMeta.scope ?? undefined,
				);
				schema = formatAnchorTableSchema(
					{ source: "table", connectionName: anchorConnection, table: openTableMeta.table, scope: openTableMeta.scope },
					columns,
				);
			} catch {
				schema = "";
			}
		}
		if (!schema) {
			try {
				schema = await getSchemaContext(anchorConnection);
			} catch {
				schema = "";
			}
		}
		return i18n.t("settings:databaseAskData.instruction", {
			connection: anchorConnection,
			schema: schema || i18n.t("settings:databaseAskData.noSchema"),
		});
	}, [effectiveConnection, openTableMeta]);

	// B2.6-R 自适应：读取活动面板当前宽度；窄屏 bottomSheet 全宽时视为 wide 三栏直出。
	const narrowScreen = useNarrowScreen();
	const panelWidth = useAtomValue(activityPanelWidthAtom);
	const effectiveWidth = narrowScreen ? Number.POSITIVE_INFINITY : panelWidth;
	const layout = useMemo(() => resolveDatabaseLayout(effectiveWidth), [effectiveWidth]);
	const { mode } = layout;
	const compact = mode === "narrow";

	// 手动显隐覆盖：null = 跟随断点自动；false/true = 强制隐藏/显示（仅对 auto 为 false 的栏有意义）。
	const [treeOverride, setTreeOverride] = useState<boolean | null>(null);
	const [detailsOverride, setDetailsOverride] = useState<boolean | null>(null);
	const [treeWidth, setTreeWidth] = useState(TREE_WIDTH_DEFAULT);
	// V5-③ 标签条响应式收纳：放不下的查询标签 key（TabBar 经 onOverflowChange 上报，渲染到「更多」下拉）。
	const [overflowTabIds, setOverflowTabIds] = useState<string[]>([]);
	// V7-⑧ 查询标签右键菜单：记录触发坐标与目标标签（内容在 JSX 组装）。
	const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

	const showTree = treeOverride ?? layout.autoTree;
	const showDetails = detailsOverride ?? layout.autoDetails;
	const treeAsOverlay = showTree && !layout.autoTree;
	const detailsAsOverlay = showDetails && !layout.autoDetails;

	// 布局档位（wide/medium/narrow）变化后由自动布局接管，清除手动覆盖；
	// 同一档位内允许用户手动开/关（如 wide 下也能用按钮隐藏连接详情）。
	const prevModeRef = useRef(mode);
	useEffect(() => {
		if (prevModeRef.current !== mode) {
			prevModeRef.current = mode;
			setTreeOverride(null);
			setDetailsOverride(null);
		}
	}, [mode]);

	const toggleTree = useCallback(() => setTreeOverride(showTree ? false : true), [showTree]);
	const toggleDetails = useCallback(() => setDetailsOverride(showDetails ? false : true), [showDetails]);
	const closeOverlays = useCallback(() => {
		setTreeOverride(null);
		setDetailsOverride(null);
	}, []);
	const onTreeResize = useCallback((delta: number) => {
		setTreeWidth((currentWidth) => Math.max(TREE_WIDTH_MIN, Math.min(TREE_WIDTH_MAX, currentWidth + delta)));
	}, []);

	// B2.7 对话→界面：连接加载完成后选中目标连接；表存在则展开并自动打开（SELECT *）。
	const initialApplied = useRef(false);
	useEffect(() => {
		if (initialApplied.current) return;
		if (!initialConnection) return;
		const connection = model.connections.find((c) => c.name === initialConnection);
		if (!connection) return;
		initialApplied.current = true;
		model.actions.select(initialConnection);
		if (initialTable) {
			explorer.actions.toggleConnection(initialConnection);
			void query.actions.openTable(connection, initialTable);
		}
	}, [explorer, initialConnection, initialTable, model.connections, model.actions, query.actions]);

	// B2.9-W1 查询同步通道（对话 → 工作台）：AI 对话中 dbx_execute_query 成功后，
	// database-tab 经 databaseTabTargetAtom 一次性传递 { connection, sql, result }，
	// 此处选中连接并回填 SQL/结果（不触发执行）。target 对象引用唯一 → 只应用一次。
	// V6-① 修复：连接列表异步加载（model.loading）期间不放弃目标 —— 就绪后本 effect
	// 重跑并回填；消费成功或确认无法消费（连接不存在 / 纯导航目标）后经
	// onSyncTargetApplied 通知上层清空 atom，防竞态丢回填、防残留重复跳转。
	const lastAppliedSyncRef = useRef<DatabaseTabTarget | null>(null);
	useEffect(() => {
		// 纯导航目标（B2.7 { connection, table }，无 sql）：initial 已由快照 props 消费，
		// 这里确认后通知清空即可。
		if (!syncTarget?.sql) {
			onSyncTargetApplied?.();
			return;
		}
		if (lastAppliedSyncRef.current === syncTarget) return;
		if (model.loading) return; // connections 未就绪：等加载完成后本 effect 重跑
		if (!model.connections.some((c) => c.name === syncTarget.connection)) {
			// 目标连接不在当前列表（已删除等）：无法消费，通知清空防残留。
			onSyncTargetApplied?.();
			return;
		}
		lastAppliedSyncRef.current = syncTarget;
		model.actions.select(syncTarget.connection);
		query.actions.applyResult(
			syncTarget.connection,
			syncTarget.sql,
			syncTarget.result ?? null,
			syncTarget.error ?? null,
			syncTarget.errorDetail ?? null,
		);
		onSyncTargetApplied?.();
	}, [syncTarget, model.connections, model.loading, model.actions, query.actions, onSyncTargetApplied]);


	// P1：chat SQL 块动作 —— 「在新查询打开」预填不执行；「执行」新建承载 tab 立即执行，
	// 危险 SQL（DDL/写）被 clamp 拦截返回 "confirm" 时复用工作台 danger-confirm UI，
	// 确认后仅对该 tab 以 confirmedWrite=true 放行。连接解析：action.connection 优先（会话锚点），
	// 缺省回退当前执行连接；两者皆无则清空动作（按钮需在真实连接下才能生效）。
	const lastAppliedSqlActionRef = useRef<DatabaseSqlAction | null>(null);
	useEffect(() => {
		if (!sqlAction) return;
		if (lastAppliedSqlActionRef.current === sqlAction) return;
		if (model.loading) return;
		const target =
			(sqlAction.connection &&
				model.connections.find((connection) => connection.name === sqlAction.connection)) ||
			effectiveConnection;
		if (!target) {
			onSqlActionApplied?.();
			return;
		}
		lastAppliedSqlActionRef.current = sqlAction;
		if (sqlAction.kind === "open") {
			query.actions.addTab(target.name, sqlAction.sql);
			onSqlActionApplied?.();
			return;
		}
		void query.actions.runSqlInNewTab(target, sqlAction.sql, false).then((outcome) => {
			if (outcome !== "confirm") return;
			setConfirm({
				title: t("databaseRunConfirmTitle"),
				message: t("databaseRunConfirmMessage", { name: target.name, sql: sqlAction.sql }),
				confirmLabel: t("databaseRunConfirmLabel"),
				variant: "danger",
				onConfirm: () => {
					recordSettingsUsage({ tab: "database", action: "changed", target: "query-run-confirmed" });
					void query.actions.runSqlInNewTab(target, sqlAction.sql, true);
				},
			});
		});
		onSqlActionApplied?.();
	}, [
		sqlAction,
		model.loading,
		model.connections,
		effectiveConnection,
		query.actions,
		setConfirm,
		t,
		onSqlActionApplied,
	]);

	// V5-③ 查询标签操作：新建 / 切换 / 关闭 / 拖拽排序（V5-④ 目标 tab 路由在模型 actions 内实现）。
	const handleNewTab = () => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-tab-new" });
		// V7-⑨ 对齐 dbx：当激活标签正在浏览某表（openTableMeta）时，新查询预填 SELECT 该表（含作用域限定 + 当前页范围）;
		// 否则为空白新标签。新建即绑定当前执行连接（激活标签绑定优先，回退树选中）。
		const meta = query.openTableMeta;
		const scopeText = meta?.scope ? (meta.scope.schema ?? meta.scope.database ?? undefined) : undefined;
		const prefilledSql = meta
			? buildOpenTableSql(meta.type, meta.table, meta.pageSize, (meta.page - 1) * meta.pageSize, scopeText)
			: null;
		query.actions.addTab(effectiveConnection?.name ?? undefined, prefilledSql);
	};
	const handleHistoryRestore = (entry: QueryHistoryEntry) => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-history-restore" });
		query.actions.addTab(entry.connection || undefined, entry.sql);
	};
	const handleHistoryCopy = (entry: QueryHistoryEntry) => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-history-copy" });
		void navigator.clipboard?.writeText(entry.sql).catch(() => {});
	};
	const handleHistoryDelete = (id: string) => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-history-delete" });
		query.actions.removeHistoryEntry(id);
	};
	const handleHistoryClear = () => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-history-clear" });
		query.actions.clearHistory();
	};
	const handleAskAiEditor = () => {
		if (!effectiveConnection?.name || !query.sql.trim()) return;
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-ask-ai-editor" });
		analyzeEditorSql(effectiveConnection.name, query.sql);
	};
	const handleHistoryAnalyze = (entry: QueryHistoryEntry) => {
		if (!entry.connection) return;
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-history-analyze" });
		analyzeHistorySql(entry.connection, entry.sql);
	};
	const handleTabContextMenu = (event: ReactMouseEvent<HTMLDivElement>, tabId: string) => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-tab-context-menu" });
		setTabMenu({ x: event.clientX, y: event.clientY, tabId });
	};
	const handleTabChange = (id: string) => {
		if (id === query.activeTabId) return;
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-tab-switch" });
		query.actions.activateTab(id);
	};
	const handleTabClose = (id: string) => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-tab-close" });
		query.actions.closeTab(id);
	};
	const handleTabReorder = (ids: string[]) => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "query-tab-reorder" });
		query.actions.reorderTabs(ids);
	};

	const treeBody: ReactNode = model.error ? (
		<div className="px-1 pt-1">
			<DatabaseNotice tone="error" title={model.error}>
				{model.errorDetail ? <DatabaseDetail>{model.errorDetail}</DatabaseDetail> : null}
			</DatabaseNotice>
		</div>
	) : model.loading ? (
		<div className="space-y-1.5 px-1 pt-1">
			{[0, 1, 2].map((i) => (
				<div key={i} className="h-[52px] animate-pulse rounded-lg bg-background/70" />
			))}
		</div>
	) : model.connections.length === 0 ? (
		<div className="flex flex-col items-center gap-2 px-4 pt-8 text-center">
			<span className="icon-[mdi--database-plus-outline] h-7 w-7 text-muted-foreground/50" />
			<p className="text-[12px] leading-relaxed text-muted-foreground">{t("databaseEmpty")}</p>
			<Button variant="outline" size="xs" onClick={model.actions.openAdd}>
				<span className="icon-[mdi--plus] h-3 w-3" />
				{t("databaseAddConnection")}
			</Button>
		</div>
	) : (
		<DatabaseExplorerTree
			userGroups={userGroups}
			onDeleteUserGroup={handleDeleteUserGroup}
			connections={model.connections}
			selectedName={selected?.name ?? null}
			explorer={explorer}
			statusOf={(name) => model.testSnapshots[name]?.status ?? "untested"}

			snapshotOf={(name) => model.testSnapshots[name] ?? null}
			onSelect={model.actions.select}
			onOpenQuery={(connection) => {
				recordSettingsUsage({ tab: "database", action: "selected", target: "query-tab-open-connection" });
				// 双击连接 → 选中该连接并新建 SQL 查询 tab(与 dbx 一致:连接树双击开新查询,tab 绑定该连接)。
				model.actions.select(connection.name);
				query.actions.addTab(connection.name);
			}}
			onOpenTable={(connection, table, scope, forceNewTab) => {
				recordSettingsUsage({ tab: "database", action: "selected", target: "query-tab-open-table" });
				void query.actions.openTable(connection, table, scope ? scopeToTableScope(scope) : null, forceNewTab);
			}}
			onAnalyzeTable={analyzeTable}
			onTestConnection={(name) => void model.actions.testSaved(name)}
			onTableCommand={handleTableCommand}
			onTableBatchCommand={handleTableBatchCommand}
			tableBatchResetNonce={tableBatchResetNonce}
			tableBatchKeepKeys={tableBatchKeepKeys}
			revealTarget={revealTarget}
		/>
	);

	const detailsBody: ReactNode = selected ? (
		<DatabaseConnectionDetailsWorkbench model={model} selected={selected} />
	) : null;

	const selectedStatus = selected ? (model.testSnapshots[selected.name]?.status ?? "untested") : "untested";

	const contentPadding = compact ? "px-4 pb-4 pt-3" : mode === "medium" ? "px-6 pb-5 pt-4" : "px-8 pb-6 pt-5";
	const contentGap = compact ? "gap-3" : mode === "medium" ? "gap-4" : "gap-5";
	const mainGap = compact ? "gap-3" : "gap-4";

	// 树/详情 toggle 按钮（仅在该栏 auto 隐藏时出现，点击以覆盖抽屉打开）
	const toggleButtonClass = (active: boolean) => cn(active && "bg-background text-foreground shadow-sm");

	return (
		<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
			<DatabaseWorkspaceHeader
				variant="toolbar"
				context={
					selected ? (
						<>
							{!compact ? <DatabaseTypeBadge type={selected.type} size="sm" /> : null}
							<span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground">{selected.name}</span>
							<DatabaseStatusPill status={selectedStatus} label={t(`databaseStatus.${selectedStatus}`)} />
						</>
					) : (
						<span className="truncate text-[12px] text-muted-foreground">{t("databaseNoConnectionSelected")}</span>
					)
				}
				actions={
					<>
						<DatabaseQueryHistoryPopover
							entries={query.history}
							onRestore={handleHistoryRestore}
							onCopy={handleHistoryCopy}
							onDelete={handleHistoryDelete}
							onClear={handleHistoryClear}
							onAnalyze={handleHistoryAnalyze}
						/>
						{/* V6-② 对齐 dbx「New Query」：新建查询入口常驻顶栏；无选中连接时禁用。 */}
						<Button
							variant="ghost"
							size="sm"
							className="h-7 shrink-0 gap-1.5 px-2.5 text-[12px] font-medium"
							disabled={!effectiveConnection}
							aria-label={t("databaseNewQuery")}
							title={t("databaseNewQuery")}
							onClick={handleNewTab}
						>
							<span className="icon-[solar--document-add-linear] h-3.5 w-3.5" />
							{!compact ? t("databaseNewQuery") : null}
						</Button>
						{!compact ? (
							<SettingsAiAssist
								tabId="databaseWorkbench"
								triggerLabel={t("databaseAskData.label")}
								buildExtraInstruction={askExtraInstruction}
								className="px-1.5"
							/>
						) : null}
						{!layout.autoTree || !showTree ? (
							<Button
								variant="ghost"
								size="sm"
								aria-pressed={showTree}
								aria-label={t("databaseConnections")}
								title={t("databaseConnections")}
								className={cn("px-2", toggleButtonClass(showTree))}
								onClick={toggleTree}
							>
								<span className="icon-[mdi--file-tree] h-4 w-4" />
							</Button>
						) : null}
						<Button
							variant="ghost"
							size="sm"
							aria-pressed={showDetails}
							aria-label={t("databaseToggleDetails")}
							title={t("databaseToggleDetails")}
							className={cn("px-2", toggleButtonClass(showDetails))}
							onClick={toggleDetails}
						>
							<span className="icon-[mdi--information-outline] h-4 w-4" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="px-2"
							aria-label={t("databaseRefresh")}
							title={t("databaseRefresh")}
							onClick={() => void model.actions.refresh()}
						>
							<span className="icon-[mdi--refresh] h-4 w-4" />
						</Button>
						<Button
							variant="primary"
							size="sm"
							className="px-2"
							aria-label={t("databaseAddConnection")}
							title={t("databaseAddConnection")}
							onClick={model.actions.openAdd}
						>
							<span className="icon-[mdi--plus] h-4 w-4" />
						</Button>
					</>
				}
			/>

			<div className={cn("flex min-h-0 flex-1", contentPadding, contentGap)}>
				{showTree && !treeAsOverlay ? (
					<aside
						style={{ width: treeWidth }}
						className="relative flex shrink-0 flex-col overflow-hidden rounded-xl bg-muted/40"
					>
						<DatabaseListHeader
							variant="toolbar"
							label={t("databaseConnections")}
							action={
								<div className="flex items-center gap-px">
									<button
										type="button"
										title={t("databaseCollapseAll")}
										aria-label={t("databaseCollapseAll")}
										className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-95"
										onClick={handleCollapseAllConnections}
									>
										<span className="h-3 w-3 icon-[solar--double-alt-arrow-up-linear]" />
									</button>
									<button
										type="button"
										title={t("databaseRefreshAll")}
										aria-label={t("databaseRefreshAll")}
										className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-95"
										onClick={handleRefreshAllConnections}
									>
										<span className="h-3 w-3 icon-[solar--refresh-linear]" />
									</button>
									<button
										type="button"
										title={t("databaseCreateGroup")}
										aria-label={t("databaseCreateGroup")}
										className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-95"
										onClick={openGroupDialog}
									>
										<span className="h-3 w-3 icon-[mdi--folder-plus-outline]" />
									</button>
									<button
										type="button"
										title={t("databaseCollapseTree")}
										aria-label={t("databaseCollapseTree")}
										className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-95"
										onClick={() => setTreeOverride(false)}
									>
										<span className="h-3 w-3 icon-[solar--double-alt-arrow-left-linear]" />
									</button>
								</div>
							}
						/>
						<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
							{tableBatchResultBanner}
							{treeBody}
						</div>
						<ResizeHandle side="right" onResize={onTreeResize} />
					</aside>
				) : null}

				<main className={cn("flex min-w-0 flex-1 flex-col", mainGap)}>
					{selected && query.empty ? (
						// #4（对齐 dbx）：已选连接但未打开任何查询/表 —— 动作驱动空态：新建查询，
						// 或双击连接树中的表/视图浏览数据；不再常驻空白查询面板 + 空结果网格。
						<motion.div
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.3, ease: EASE_OUT }}
							className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center"
						>
							<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
								<span className="icon-[mdi--code-braces] h-8 w-8" />
							</div>
							<h2 className="text-[17px] font-bold text-foreground">{t("databaseQueryEmptyTitle")}</h2>
							<p className="max-w-[380px] text-[12.5px] leading-relaxed text-muted-foreground">
								{t("databaseQueryEmptyDescription")}
							</p>
							<Button variant="primary" size="sm" onClick={handleNewTab}>
								<span className="icon-[mdi--plus] h-4 w-4" />
								{t("databaseNewQuery")}
							</Button>
						</motion.div>
					) : selected || query.activeTabConnectionName ? (
						<>
							{/* V5-③ 多查询标签条：切换 / 关闭（hover 减号）/ 拖拽排序 / 溢出收纳。新建入口统一在顶部工具栏与空态（V7-⑩ 去掉标签栏右侧「+」冗余入口，对齐 dbx）。 */}
							<div className="flex min-w-0 items-end gap-1">
								<TabBar
									className="min-w-0 flex-1"
									items={query.tabs.map((tab) => ({ key: tab.id, label: tab.title, removable: true }))}
									value={query.activeTabId ?? ""}
									onChange={handleTabChange}
									onRemove={handleTabClose}
									onReorder={handleTabReorder}
									onOverflowChange={setOverflowTabIds}
									onContextMenu={handleTabContextMenu}
								/>
								{overflowTabIds.length > 0 ? (
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
													variant="ghost"
													size="sm"
													className="mb-0.5 h-6 shrink-0 gap-1 px-2 text-[11px]"
													aria-label={t("databaseMoreTabs")}
													title={t("databaseMoreTabs")}
												>
													<span className="icon-[mdi--dots-horizontal] h-3.5 w-3.5" />
												</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="w-48">
											{overflowTabIds.map((id) => {
												const tab = query.tabs.find((item) => item.id === id);
												return tab ? (
													<DropdownMenuItem key={id} onClick={() => handleTabChange(id)}>
														<span className="min-w-0 truncate">{tab.title}</span>
													</DropdownMenuItem>
												) : null;
											})}
										</DropdownMenuContent>
									</DropdownMenu>
								) : null}
							</div>
							{/* V7-⑧ 查询标签右键菜单：复制名称 / 复制标签 / 关闭 / 关闭其他 / 关闭全部（对齐 dbx 顺序；关闭类危险色；复用树右键菜单浮层）。 */}
							{tabMenu ? (
								<DatabaseExplorerContextMenu
									x={tabMenu.x}
									y={tabMenu.y}
									onClose={() => setTabMenu(null)}
									items={
										[
											{
												key: "copy-name",
												icon: "icon-[mdi--content-copy]",
												label: t("databaseCopyName"),
												onSelect: () => {
													recordSettingsUsage({ tab: "database", action: "selected", target: "query-tab-copy-name" });
													const source = query.tabs.find((item) => item.id === tabMenu.tabId);
													if (source) void navigator.clipboard.writeText(source.title);
												},
											},

											{
												key: "duplicate",
												icon: "icon-[mdi--content-copy]",
												label: t("databaseDuplicateTab"),
												onSelect: () => query.actions.duplicateTab(tabMenu.tabId),
											},
											{ key: "sep-close", separator: true },
											{
												key: "close",
												icon: "icon-[mdi--close]",
												label: t("databaseCloseTab"),
												destructive: true,
												onSelect: () => query.actions.closeTab(tabMenu.tabId),
											},
											...(query.tabs.length > 1
												? [
														{
															key: "close-others",
															icon: "icon-[mdi--close-box-outline]",
															label: t("databaseCloseOtherTabs"),
															destructive: true,
															onSelect: () => query.actions.closeOtherTabs(tabMenu.tabId),
														},
												  ]
												: []),
											{
												key: "close-all",
												icon: "icon-[mdi--close-box-multiple-outline]",
												label: t("databaseCloseAllTabs"),
												destructive: true,
												onSelect: () => query.actions.closeAllTabs(),
											},
										] satisfies readonly DatabaseContextMenuItem[]
									}
								/>
							) : null}
							{/* V6-③ 打开表浏览 tab：隐藏 SQL 编辑器（对齐 dbx 数据页：表数据即界面主体），仅显示结果网格；
							    查询 tab 才渲染编辑器。 */}
							{query.openTableMeta ? null : (
							<DatabaseQueryPanel
								// V7-④ 空闲(未执行/无输出)时编辑器伸展占满主体,对齐 dbx“编辑器为主体、结果面板执行后才展开”。
								stretch={query.status === "idle"}
								connection={effectiveConnection}
								connections={model.connections}
								boundConnectionName={query.activeTabConnectionName}
								onRebindConnection={(name) => {
									const target = model.connections.find((item) => item.name === name);
									if (target) query.actions.rebindConnection(target);
								}}
								sql={query.sql}
								busy={query.status === "running"}
								history={query.history}
								onChange={query.actions.setSql}
								onRun={() => {
								if (!effectiveConnection) return;
								void query.actions.run(effectiveConnection).then((outcome) => {
									if (outcome !== "confirm") return;
									setConfirm({
										title: t("databaseRunConfirmTitle"),
									message: t("databaseRunConfirmMessage", { name: effectiveConnection.name, sql: query.sql }),
										confirmLabel: t("databaseRunConfirmLabel"),
										variant: "danger",
										onConfirm: () => {
											recordSettingsUsage({ tab: "database", action: "changed", target: "query-run-confirmed" });
										void query.actions.runConfirmed(effectiveConnection);
										},
									});
								});
							}}
							onClearHistory={query.actions.clearHistory}
							onAskAi={handleAskAiEditor}
							/>
							)}
							{query.openTableMeta || query.status !== "idle" ? (
							<DatabaseResultGrid
								status={query.status}
								result={query.result}
								connectionName={query.resultConnectionName}
								error={query.error}
								errorDetail={query.errorDetail}
								canGoNextPage={query.canGoNextPage}
								page={query.page}
								pageSize={query.pageSize}
								loadingPage={query.loadingPage}
								onGoToPage={(target) => {
									if (!effectiveConnection) return;
									recordSettingsUsage({ tab: "database", action: "selected", target: "result-page-goto" });
									void query.actions.goToPage(effectiveConnection, target);
								}}
									onPageSizeChange={(size) => {
										if (!effectiveConnection) return;
										recordSettingsUsage({ tab: "database", action: "selected", target: "result-page-size" });
										// 切换每页行数后回第 1 页，避免新范围落在页尾（对齐 dbx rows-per-page）。
										void query.actions.goToPage(effectiveConnection, 1, size);
									}}
								// B3.2-R 数据编辑（讨论定案）：添加行（INSERT）始终可用（无需主键定位）；
								// 单元格编辑/删行需主键（pkColumns.length > 0），无主键时禁用并由 editDisabledReason 说明；
								// describeTable 失败也需暴露原因（pkState=failed）；按钮常显，自由 SQL 不可编辑查询显示只读徽章。
								editable={editTarget !== null && query.status === "success" && pkState === "ready" && pkColumns.length > 0}
								canAddRow={editTarget !== null && query.status === "success"}
								editDisabledReason={
									query.status !== "success"
										? t("databaseEditDisabledQueryFailed")
										: pkState === "failed"
											? t("databaseEditDisabledDescribeFailed")
											: !editTarget && !editability.editable
												? t(`databaseEditReadOnlyReason.${editability.reason}`)
												: editTarget && pkState === "ready" && pkColumns.length === 0
													? t("databaseEditDisabledNoPk")
													: null
								}
								readOnlyReason={
									!query.openTableMeta && query.status === "success" && query.result && !editability.editable
										? editability.reason
										: null
								}
								showKeylessWarning={
									editTarget !== null && query.status === "success" && pkState === "ready" && pkColumns.length > 0 && !pkColumns.some((pk) => lastResultColumns.includes(pk))
								}
								onRefresh={() => {
									if (!effectiveConnection) return;
									recordSettingsUsage({ tab: "database", action: "selected", target: "result-refresh" });
									if (query.openTableMeta) void query.actions.reloadOpenTable(effectiveConnection);
									else if (query.resultSql) void query.actions.rerun(effectiveConnection, query.resultSql);
								}}
								tableName={query.openTableMeta?.table ?? null}
								writeError={writeError}
								onDismissWriteError={() => setWriteError(null)}
								onSaveCell={handleSaveCell}
								onAddRow={handleAddRow}
								onDeleteRow={handleDeleteRow}
								onAnalyzeResult={
									// B3.3 失败解读：SQL 存在且（有结果或有错误）时均可让 AI 分析（成功解读 / 解释错误）。
									lastResultSql && (lastResult || query.error) && effectiveConnection
										? () =>
												analyzeResult({
													connection: effectiveConnection,
													sql: lastResultSql,
													result: lastResult,
													error: query.error,
													errorDetail: query.errorDetail,
												})
										: undefined
								}
							/>
							) : null}
						</>
					) : (
						<motion.div
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.4, ease: EASE_OUT }}
							className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center"
						>
							<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
								<span className="icon-[solar--database-linear] h-8 w-8" />
							</div>
							<h2 className="text-[17px] font-bold text-foreground">{t("databaseEmptyTitle")}</h2>
							<p className="max-w-[360px] text-[12.5px] leading-relaxed text-muted-foreground">
								{t("databaseEmptyDescription")}
							</p>
							<Button variant="primary" size="sm" onClick={model.actions.openAdd}>
								<span className="icon-[mdi--plus] h-4 w-4" />
								{t("databaseAddConnection")}
							</Button>
						</motion.div>
					)}
				</main>

				{showDetails && !detailsAsOverlay && selected ? (
					<aside className="w-[320px] shrink-0 overflow-y-auto rounded-xl bg-muted/40 px-4 py-4">{detailsBody}</aside>
				) : null}
			</div>

			{treeAsOverlay || detailsAsOverlay ? (
				<div className="absolute inset-0 z-30">
					<div className="absolute inset-0 bg-black/25" onClick={closeOverlays} />
					{treeAsOverlay ? (
						<aside className="absolute bottom-0 left-0 top-0 z-10 flex w-[min(300px,calc(100%-40px))] flex-col overflow-hidden rounded-r-xl bg-muted/95 shadow-2xl">
						<DatabaseListHeader
							variant="toolbar"
							label={t("databaseConnections")}
							action={
								<div className="flex items-center gap-px">
									<button
										type="button"
										title={t("databaseCollapseAll")}
										aria-label={t("databaseCollapseAll")}
										className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-95"
										onClick={handleCollapseAllConnections}
									>
										<span className="h-3 w-3 icon-[solar--double-alt-arrow-up-linear]" />
									</button>
									<button
										type="button"
										title={t("databaseRefreshAll")}
										aria-label={t("databaseRefreshAll")}
										className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-95"
										onClick={handleRefreshAllConnections}
									>
										<span className="h-3 w-3 icon-[solar--refresh-linear]" />
									</button>
									<button
										type="button"
										title={t("databaseCreateGroup")}
										aria-label={t("databaseCreateGroup")}
										className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-95"
										onClick={openGroupDialog}
									>
										<span className="h-3 w-3 icon-[mdi--folder-plus-outline]" />
									</button>
									<button
										type="button"
										title={t("databaseCollapse")}
										aria-label={t("databaseCollapse")}
										className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-95"
										onClick={() => setTreeOverride(false)}
									>
										<span className="h-3 w-3 icon-[mdi--close]" />
									</button>
								</div>
							}
						/>
							<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">{treeBody}</div>
						</aside>
					) : null}
					{detailsAsOverlay && selected ? (
						<aside className="absolute bottom-0 right-0 top-0 z-10 w-[min(340px,calc(100%-40px))] overflow-y-auto rounded-l-xl bg-muted/95 px-4 py-4 shadow-2xl">
							<div className="mb-3 flex items-center justify-between">
								<DatabaseSectionLabel icon="icon-[mdi--information-outline]">{t("databaseToggleDetails")}</DatabaseSectionLabel>
								<Button
									variant="ghost"
									size="xs"
									aria-label={t("databaseCollapse")}
									title={t("databaseCollapse")}
									onClick={() => setDetailsOverride(false)}
								>
									<span className="icon-[mdi--close] h-4 w-4" />
								</Button>
							</div>
							{detailsBody}
						</aside>
					) : null}
				</div>
			) : null}

			<DatabaseConnectionForm
				open={model.addOpen}
				busy={model.formBusy}
				testing={model.formTesting}
				error={model.formError}
				errorDetail={model.formErrorDetail}
				testResult={model.formTestResult}
				form={model.form}
				onChange={model.actions.changeForm}
				onCancel={model.actions.cancelAdd}
				onPickFile={model.actions.pickFile}
				onSave={() => void model.actions.submitAdd()}
				onTest={() => void model.actions.testDraft()}
			/>
			{createGroupDialog}
			{tableDialogs}
		</div>
	);
}
