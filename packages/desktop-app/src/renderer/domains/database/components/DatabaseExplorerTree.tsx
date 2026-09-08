import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type JSX,
	type MouseEvent as ReactMouseEvent,
} from "react";
import { Button, cn, Spin } from "@astravia/ui";
import { useTranslation } from "react-i18next";
import type {
	DbCatalogFamily,
	DbCatalogScope,
	DbColumnInfo,
	DbConnection,
	DbTableInfo,
	DbTableObjectKind,
} from "../../../../preload/api-types/database";
import { recordSettingsUsage } from "../../settings/components/recordSettingsUsage";
import {
	connectionMatchesQuery,
	filterConnections,
	filterKindSections,
	filterTables,
	groupConnections,
	qualifiedTableName,
	sortConnectionsByName,
	splitTableKindSections,
	tableMatchesQuery,
	type ConnectionSortOrder,
	type TableKindFilter,
} from "../lib/database-tree";
import { DatabaseStatusDot } from "./DatabaseStatus";
import { DatabaseTypeBadge } from "./DatabaseTypeBadge";
import {
	DatabaseExplorerContextMenu,
	type DatabaseContextMenuItem,
} from "./DatabaseExplorerContextMenu";
import {
	ExplorerOrderableRow,
	ExplorerRowOrderContext,
	RowPinButton,
	rowIsPinned,
	useExplorerRowOrder,
	type ExplorerRowOrderController,
} from "./explorer-row-tools";
import { catalogFamilyOfType } from "../lib/catalog-family";
import type { DatabaseExplorerModel, ExplorerListNode } from "../hooks/useDatabaseExplorerModel";
import { TABLE_OBJECT_KINDS } from "../hooks/useDatabaseExplorerModel";
import type { DatabaseConnectionTestSnapshot, DatabaseConnectionTestStatus } from "../hooks/useDatabaseWorkspaceModel";
import { loadExplorerToolbarState, saveExplorerToolbarState } from "../lib/explorer-toolbar-state";
import {
	EMPTY_ROW_ORDER,
	applyOrderToItems,
	connectionRowContainer,
	flatTableRowContainer,
	loadExplorerOrder,
	moveRowAcross,
	saveExplorerOrder,
	scopeRowContainer,
	tableRowContainer,
	toggleRowPin,
	type ExplorerOrderMap,
	type RowOrder,
} from "../lib/explorer-order";
import {
	filterScopesByVisibility,
	filterTablesByVisibility,
	loadExplorerVisibility,
	saveExplorerVisibility,
	type ConnectionVisibility,
	type ExplorerVisibilityMap,
} from "../lib/explorer-visibility";

interface DatabaseExplorerTreeProps {
	/** 用户自定义分组名（顶部「+」新建，持久化本地）；树按创建序置顶渲染为空分组（对齐 dbx「新建分组」）。 */
	readonly userGroups?: readonly string[];
	/** 删除用户自定义分组（仅移除本地组名，连接原样保留）。 */
	onDeleteUserGroup?: (group: string) => void;

	connections: readonly DbConnection[];
	selectedName: string | null;
	explorer: DatabaseExplorerModel;
	/** 连接状态（来自测试快照），用于连接行状态点。 */
	statusOf: (name: string) => DatabaseConnectionTestStatus;
	/** 可选：连接测试快照（含最近测试时间/详情），供状态点悬浮提示。缺省时状态点无提示。 */
	readonly snapshotOf?: (name: string) => DatabaseConnectionTestSnapshot | null;
	onSelect: (name: string) => void;
	/** 双击连接：打开新的 SQL 查询 tab（对齐 dbx —— 单击选中，双击新建查询绑定该连接）。 */
	onOpenQuery: (connection: DbConnection) => void;
	/** 打开表浏览（对齐 dbx 单击即开）：scope 为 catalog 分层连接（PG schema / MySQL database）下表的限定位置；forceNewTab=true（⌘/Ctrl+单击）强制新开 tab，否则同表复用。 */
	onOpenTable: (connection: DbConnection, table: string, scope?: DbCatalogScope, forceNewTab?: boolean) => void;
	/** 分析表：scope 同上。 */
	onAnalyzeTable: (connection: DbConnection, table: string, scope?: DbCatalogScope) => void;
	/** 表级套件：导出 CSV/JSON、清空/重命名/删除表。宿主统一处理（原生保存对话框 + 危险确认 + 确认写通道）。 */
	readonly onTableCommand?: (command: TableCommand) => void;
	/** 表批量套件（批次3 #16，对齐 dbx）：树内多选表后的批量动作（导出 CSV/JSON / 清空 / 删除）由此发出，宿主逐表确认写通道执行并汇总反馈。 */
	readonly onTableBatchCommand?: (command: TableBatchCommand) => void;
	/** 表批量重置信号：宿主完成一轮批量动作后自增，树据此清空残留勾选。 */
	readonly tableBatchResetNonce?: number;
	/** 批量动作完成后保留的勾选 key（失败的项保留便于重试；与 tableBatchResetNonce 搭配：清空除 keep 外的勾选）。 */
	readonly tableBatchKeepKeys?: readonly string[];
	/** 可选：测试连接动作（供连接行「测试」入口，缺省时隐藏）。 */
	readonly onTestConnection?: (name: string) => void;
	/** 可选：定位目标（当前激活表）。传入时工具条「定位当前表」可自动展开并滚动到该行。 */
	readonly revealTarget?: DatabaseRevealTarget | null;
}

/** 表级套件命令：由表右键菜单发出，宿主（DatabaseWorkspace）统一处理（导出/危险确认+写通道）。 */
export type TableCommand =
	| { kind: "exportCsv"; connection: DbConnection; table: DbTableInfo; scope?: DbCatalogScope }
	| { kind: "exportJson"; connection: DbConnection; table: DbTableInfo; scope?: DbCatalogScope }
	| { kind: "truncate"; connection: DbConnection; table: DbTableInfo; scope?: DbCatalogScope }
	| { kind: "rename"; connection: DbConnection; table: DbTableInfo; scope?: DbCatalogScope }
	| { kind: "drop"; connection: DbConnection; table: DbTableInfo; scope?: DbCatalogScope };

/** 「定位当前表」目标：connection 连接名 + scope 作用域名（flat 连接为 null）+ table 表名。 */
export interface DatabaseRevealTarget {
	readonly connection: string;
	readonly table: string;
	readonly scope: string | null;
}

/** 表批量选择集目标（批次3 #16，对齐 dbx 对象浏览器勾选多选）。scope 与 TableCommand 一致；view 仅参与导出。 */
export interface TableBatchTarget {
	readonly connection: DbConnection;
	readonly table: string;
	readonly scope?: DbCatalogScope;
	readonly view: boolean;
}

/** 表批量选择集 key（连接名 + schema/db 分层 scope 下唯一）。 */
export function tableSelectionKey(connection: DbConnection, table: string, scope?: DbCatalogScope): string {
	return scope ? `${connection.name}\u0000${scope.name}\u0000${table}` : `${connection.name}\u0000${table}`;
}

export type TableBatchAction = "exportCsv" | "exportJson" | "truncate" | "drop";

/** 表批量套件命令：树内批量动作条发出，宿主（DatabaseWorkspace）统一执行并汇总反馈。 */
export type TableBatchCommand =
	| { action: "exportCsv"; targets: readonly TableBatchTarget[] }
	| { action: "exportJson"; targets: readonly TableBatchTarget[] }
	| { action: "truncate"; targets: readonly TableBatchTarget[] }
	| { action: "drop"; targets: readonly TableBatchTarget[] };

/** 树内表多选上下文：勾选态在树内维护；宿主通过 onTableBatchCommand 消费选择集。 */
interface TableMultiContextValue {
	readonly map: ReadonlyMap<string, TableBatchTarget>;
	readonly active: boolean;
	readonly toggle: (connection: DbConnection, table: string, scope: DbCatalogScope | undefined, view: boolean) => void;
	readonly clear: () => void;
}

const TableMultiContext = createContext<TableMultiContextValue | null>(null);

function useTableMulti(): TableMultiContextValue | null {
	return useContext(TableMultiContext);
}

const SEARCH_DEBOUNCE_MS = 300;

function NodeErrorRow({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
			<span className="min-w-0 truncate text-[11.5px] text-destructive">{message}</span>
			<Button variant="ghost" size="xs" onClick={onRetry}>
				<span className="icon-[lucide--refresh-cw] h-3 w-3" />
				{t("databaseRetry")}
			</Button>
		</div>
	);
}

function ColumnRows({
	node,
	onRetry,
	onContextMenu,
}: {
	node: ExplorerListNode<DbColumnInfo>;
	onRetry: () => void;
	onContextMenu: (event: ReactMouseEvent, column: DbColumnInfo) => void;
}): JSX.Element {
	const { t } = useTranslation("settings");
	if (node.loading) {
		return (
			<div className="flex items-center gap-2 px-2 py-1.5">
				<Spin size="sm" />
			</div>
		);
	}
	if (node.error) return <NodeErrorRow message={node.error} onRetry={onRetry} />;
	return (
		<>
			{node.items.map((column) => (
				<div
					key={column.name}
					className="flex cursor-context-menu items-center gap-1.5 rounded-md px-2 py-1 hover:bg-background/50"
					title={`${column.name} ${column.type}`}
					onContextMenu={(event) => onContextMenu(event, column)}
				>
					<span
						className={cn(
							"h-3 w-3 shrink-0",
							column.isPrimaryKey ? "icon-[lucide--columns-3] text-orange-500/80" : "icon-[lucide--columns-3] text-muted-foreground/50",
						)}
					/>
					<span className="min-w-0 truncate text-[11.5px] text-foreground/80">{column.name}</span>
					<span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground/60">{column.type}</span>
				</div>
			))}
			{node.items.length === 0 ? (
				<div className="px-2 py-1 text-[11.5px] text-muted-foreground/60">{t("databaseNoColumns")}</div>
			) : null}
		</>
	);
}

const OBJECT_ICON: Record<DbTableObjectKind, string> = {
	index: "icon-[lucide--key-round] text-amber-600",
	constraint: "icon-[lucide--link-2] text-sky-600",
	"foreign-key": "icon-[lucide--arrow-left-right] text-rose-600",
	trigger: "icon-[lucide--zap] text-orange-500",
	partition: "icon-[lucide--layers] text-slate-500",
};

/** #5：表级子对象分区（索引/约束/外键/触发器/分区）。flat(单库) 连接 scope 为空 → 不渲染；无子对象整块隐藏。 */
function TableObjectRows({
	explorer,
	connection,
	table,
	scope,
}: {
	explorer: DatabaseExplorerModel;
	connection: DbConnection;
	table: string;
	scope?: DbCatalogScope;
}): JSX.Element {
	const { t } = useTranslation("settings");
	// flat（无 scope）没有 introspection；无任何子对象数据则整块隐藏。
	if (!scope || !explorer.hasAnyObjects(connection.name, table, scope)) return <></>;
	return (
		<>
			{TABLE_OBJECT_KINDS.map((kind) => {
				const node = explorer.objectsOf(connection.name, table, kind, scope);
				if (!node.loading && !node.error && node.items.length === 0) return null;
				return (
					<div key={kind}>
						<div className="flex items-center gap-1.5 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/55">
							<span className={cn("h-3 w-3", OBJECT_ICON[kind])} />
							{t(`databaseObject.${kind}`)}
							{node.loaded ? <span className="text-muted-foreground/40">({node.items.length})</span> : null}
						</div>
						{node.loading ? (
							<div className="flex items-center gap-2 px-2 py-1">
								<Spin size="sm" />
							</div>
						) : node.error ? (
							<NodeErrorRow
								message={node.error}
								onRetry={() => explorer.actions.reloadObjects(connection.name, table, scope)}
							/>
						) : (
							node.items.map((name) => (
								<div
									key={name}
									className="flex cursor-default items-center gap-1.5 rounded px-2 py-0.5 text-[11.5px] text-foreground/70 hover:bg-background/50"
								>
									<span className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50 icon-[lucide--ellipsis]" />
									<span className="min-w-0 truncate">{name}</span>
								</div>
							))
						)}
					</div>
				);
			})}
		</>
	);
}


/** 表/视图分区小标题（对齐 dbx 的 Tables / Views 分区节点）。 */
function TableKindSectionHeader({ kind, count }: { kind: "tables" | "views"; count: number }): JSX.Element {
	const { t } = useTranslation("settings");
	const view = kind === "views";
	return (
		<div className="flex items-center gap-1.5 px-2 pb-0.5 pt-2">
			<span
				className={cn(
					"h-3 w-3 shrink-0",
					view ? "icon-[lucide--eye] text-violet-500/80" : "icon-[lucide--table-2] text-green-600/80",
				)}
			/>
			<span className="min-w-0 truncate text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/50">
				{t(view ? "databaseViewsSection" : "databaseTablesSection")}
			</span>
			<span className="ml-auto shrink-0 text-[10px] text-muted-foreground/40">{count}</span>
		</div>
	);
}

/**
 * catalog 中间层节点（P2 #8/#9，对齐 dbx 树：连接 → schema/database → 表 → 列）。
 * 挂载时确保作用域枚举已加载；作用域行单击展开/折叠并懒加载该作用域的表。
 */
function ScopeRows({
	connection,
	family,
	explorer,
	onOpenTable,
	onAnalyzeTable,
	onScopeContextMenu,
	onTableContextMenu,
	onColumnContextMenu,
	searchQuery,
	searching,
	kindFilter,
	visibility,
}: {
	connection: DbConnection;
	family: DbCatalogFamily;
	explorer: DatabaseExplorerModel;
	onOpenTable: (connection: DbConnection, table: string, scope?: DbCatalogScope, forceNewTab?: boolean) => void;
	onAnalyzeTable: (connection: DbConnection, table: string, scope?: DbCatalogScope) => void;
	onScopeContextMenu: (event: ReactMouseEvent, connection: DbConnection, scope: DbCatalogScope) => void;
	onTableContextMenu: (event: ReactMouseEvent, connection: DbConnection, table: DbTableInfo, scope?: DbCatalogScope) => void;
	onColumnContextMenu: (event: ReactMouseEvent, column: DbColumnInfo) => void;
	searchQuery: string;
	searching: boolean;
	kindFilter: TableKindFilter;
	visibility: ConnectionVisibility | undefined;
}): JSX.Element | null {
	const { t } = useTranslation("settings");
	const { orderMap, togglePin } = useExplorerRowOrder();
	const node = explorer.scopesOf(connection.name);
	// 首次渲染（连接展开）时确保作用域枚举已取数；ensureScopes 内部有「已加载/加载中/失败」守卫，幂等。
	useEffect(() => {
		explorer.actions.ensureScopes(connection.name, family);
	}, [explorer, connection.name, family]);

	if (node.loading) {
		return (
			<div className="flex items-center gap-2 px-2 py-1.5">
				<Spin size="sm" />
			</div>
		);
	}
	if (node.error) {
		return <NodeErrorRow message={node.error} onRetry={() => explorer.actions.reloadScopes(connection.name, family)} />;
	}
	if (node.loaded && node.items.length === 0) {
		return (
			<div className="px-2 py-1.5 text-[11.5px] text-muted-foreground/60">
				{t(family === "schemas" ? "databaseSchemasEmpty" : "databaseDatabasesEmpty")}
			</div>
		);
	}
	const schemas = family === "schemas";
	const normalized = searchQuery.trim().toLowerCase();
	const searchingActive = searching && normalized.length > 0;
	const connectionMatched = !searchingActive || connectionMatchesQuery(connection, normalized);
	// 搜索时：连接名命中保留全部 scope；否则仅保留 scope 名命中、或其下已加载表名命中的 scope。
	const scopeVisibility = filterScopesByVisibility(node.items, visibility?.scopes);
	const visibleScopes =
		searchingActive && !connectionMatched
			? scopeVisibility.filter(
					(scope) =>
						scope.name.toLowerCase().includes(normalized) ||
						explorer.tablesOf(connection.name, scope).items.some((table) => tableMatchesQuery(table, normalized)),
				)
			: scopeVisibility;
	// 批次2-② 全部作用域被「隐藏该库/模式」排除时整段收起（区别于搜索无命中空态）。
	if (node.loaded && node.items.length > 0 && scopeVisibility.length === 0) {
		return null;
	}
	if (node.loaded && visibleScopes.length === 0) {
		return <div className="px-2 py-1.5 text-[11.5px] text-muted-foreground/60">{t("databaseNoTables")}</div>;
	}
	const scopeContainer = scopeRowContainer(connection.name);
	const scopeNames = visibleScopes.map((scope) => scope.name);
	const orderedScopes = applyOrderToItems(visibleScopes, orderMap[scopeContainer]);
	return (
		<>
			{orderedScopes.map((scope) => {
				const scopeMatched = connectionMatched || scope.name.toLowerCase().includes(normalized);
				const tableHit =
					!scopeMatched &&
					explorer.tablesOf(connection.name, scope).items.some((table) => tableMatchesQuery(table, normalized));
				const expanded = searchingActive ? scopeMatched || tableHit : explorer.isScopeExpanded(connection.name, scope);
				return (
					<div key={scope.name}>
					<ExplorerOrderableRow
						container={scopeContainer}
						name={scope.name}
						names={scopeNames}
						disabled={searchingActive}
						className="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-background/60"
						onClick={() => explorer.actions.toggleScope(connection.name, scope)}
						onContextMenu={(event) => onScopeContextMenu(event, connection, scope)}
						title={schemas ? t("databaseSchemaHint") : t("databaseDatabaseHint")}
					>
							<span
								className={cn(
									"h-3 w-3 shrink-0 transition-transform",
									expanded && "rotate-90",
									"icon-[lucide--chevron-right]",
								)}
							/>
							<span
								className={cn(
									"h-3.5 w-3.5 shrink-0",
									schemas ? "icon-[lucide--folder-open] text-sky-500/80" : "icon-[lucide--database] text-amber-500/80",
								)}
							/>
							<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">{scope.name}</span>

							{!searchingActive ? (
								<RowPinButton
									pinned={rowIsPinned(orderMap, scopeContainer, scope.name)}
									onToggle={() => togglePin(scopeContainer, scopeNames, scope.name)}
								/>
							) : null}
					</ExplorerOrderableRow>
						{expanded ? (
							<div className="ml-[13px] pl-1.5">
								<TableRows
									connection={connection}
									explorer={explorer}
									scope={scope}
									onOpenTable={onOpenTable}
									onAnalyzeTable={onAnalyzeTable}
									onContextMenu={onTableContextMenu}
									onColumnContextMenu={onColumnContextMenu}
									searchQuery={searchingActive && !scopeMatched ? searchQuery : ""}

										visibility={visibility}
										kindFilter={kindFilter}
										/>
							</div>
						) : null}
					</div>
				);
			})}
		</>
	);
}

function TableRows({
	connection,
	explorer,
	onOpenTable,
	onAnalyzeTable,
	onContextMenu,
	onColumnContextMenu,
	searchQuery,
	kindFilter,
	visibility,
	scope,
}: {
	connection: DbConnection;
	explorer: DatabaseExplorerModel;
	onOpenTable: (connection: DbConnection, table: string, scope?: DbCatalogScope, forceNewTab?: boolean) => void;
	onAnalyzeTable: (connection: DbConnection, table: string, scope?: DbCatalogScope) => void;
	onContextMenu: (event: ReactMouseEvent, connection: DbConnection, table: DbTableInfo, scope?: DbCatalogScope) => void;
	onColumnContextMenu: (event: ReactMouseEvent, column: DbColumnInfo) => void;
	/** V6-①：搜索词（表名命中时只显示命中的表行；连接名命中或空查询显示全部）。 */
	searchQuery: string;
	/** catalog 作用域（PG schema / MySQL database）：scope 内表行用作用域化数据源；flat 连接省略。 */
	scope?: DbCatalogScope;
	/** 工具条类型过滤：全部 / 仅表 / 仅视图。 */
	kindFilter: TableKindFilter;
	visibility: ConnectionVisibility | undefined;
}): JSX.Element | null {
	const { t } = useTranslation("settings");
	const { orderMap, togglePin } = useExplorerRowOrder();
	const tableMulti = useTableMulti();
	const node = explorer.tablesOf(connection.name, scope);
	if (node.loading) {
		return (
			<div className="flex items-center gap-2 px-2 py-1.5">
				<Spin size="sm" />
			</div>
		);
	}
	if (node.error) {
		return <NodeErrorRow message={node.error} onRetry={() => explorer.actions.reloadTables(connection.name, scope)} />;
	}
	// V6-①：搜索时若连接名未命中（仅表名命中），只显示命中的表行，避免「搜到连接但表全显示」。
	const normalized = searchQuery.trim().toLowerCase();
	const visibleItems =
		normalized && !connectionMatchesQuery(connection, normalized)
			? filterTables(node.items, normalized)
			: node.items;

	const visibilityFiltered = filterTablesByVisibility(visibleItems, visibility?.tables);
	// 批次2-② 全部表被「隐藏该表」排除时整段收起（区别于搜索无命中空态）。
	if (node.loaded && visibleItems.length > 0 && visibilityFiltered.length === 0) {
		return null;
	}
	if (node.loaded && visibleItems.length === 0) {
		return <div className="px-2 py-1.5 text-[11.5px] text-muted-foreground/60">{t("databaseNoTables")}</div>;
	}
	// V2 对齐 dbx 对象分区：BASE TABLE → 表分区；VIEW / SYSTEM VIEW / MATERIALIZED VIEW → 视图分区。
	// V6-② 类型过滤：工具条全部/仅表/仅视图；当前分区无匹配时显示空态而非空白。
	const sections = filterKindSections(splitTableKindSections(visibilityFiltered), kindFilter);
	if (node.loaded && visibleItems.length > 0 && sections.length === 0) {
		return <div className="px-2 py-1.5 text-[11.5px] text-muted-foreground/60">{t("databaseNoKindMatches")}</div>;
	}

	const tableContainerBase = scope ? tableRowContainer(connection.name, scope) : flatTableRowContainer(connection.name);
	const orderedSections = sections.map((section) => {
		const items = applyOrderToItems(section.items, orderMap[`${tableContainerBase}::${section.kind}`]);
		return { ...section, items, names: items.map((table) => table.name) };
	});
	return (
		<>
			{orderedSections.map((section) => (
				<div key={section.kind}>
					<TableKindSectionHeader kind={section.kind} count={section.items.length} />
					{section.items.map((table: DbTableInfo) => {
						const expanded = explorer.isTableExpanded(connection.name, table.name, scope);
						const columns = explorer.columnsOf(connection.name, table.name, scope);
						const view = section.kind === "views";
						const multiKey = tableMulti ? tableSelectionKey(connection, table.name, scope) : null;
						const tableChecked = multiKey !== null && (tableMulti?.map.has(multiKey) ?? false);
						return (
							<div key={table.name} data-db-table={table.name} data-db-scope={scope?.name ?? ""}>
								<ExplorerOrderableRow
									container={`${tableContainerBase}::${section.kind}`}
									name={table.name}
									names={section.names}
									disabled={normalized.length > 0}
									className={cn(
										"group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-background/60",
										tableMulti?.active && "bg-primary/[0.05]",
									)}
									onClick={(event) => {
										void onOpenTable(connection, table.name, scope, event.metaKey || event.ctrlKey);
									}}
									onContextMenu={(event) => onContextMenu(event, connection, table, scope)}
									title={t("databaseOpenHint")}
								>
										{/* 批次3 #16 表多选勾选：悬停出现空白框；任一勾选后常驻并随态着色。 */}
										<button
											type="button"
											aria-label={tableChecked ? t("databaseDeselectTable") : t("databaseSelectTable")}
											title={tableChecked ? t("databaseDeselectTable") : t("databaseSelectTable")}
											className={cn(
												"hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground group-hover:flex",
												tableMulti?.active && "flex",
											)}
											onClick={(event) => {
												event.stopPropagation();
												tableMulti?.toggle(connection, table.name, scope, view);
											}}
										>
											<span
												className={cn(
													"h-3.5 w-3.5",
													tableChecked
														? "icon-[lucide--square-check-big] text-primary"
														: "icon-[lucide--square] text-muted-foreground/45",
												)}
											/>
										</button>
									<button
										type="button"
										aria-label={expanded ? t("databaseCollapse") : t("databaseExpand")}
										className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/70"
										onClick={(event) => {
											event.stopPropagation();
										explorer.actions.toggleTable(connection.name, table.name, scope);
										}}
									>
										<span className={cn("h-3 w-3 transition-transform", expanded && "rotate-90", "icon-[lucide--chevron-right]")} />
									</button>
									<span
										className={cn(
											"h-3.5 w-3.5 shrink-0",
											view ? "icon-[lucide--eye] text-violet-500/80" : "icon-[lucide--table-2] text-green-600/80",
										)}
									/>
									<span className="min-w-0 truncate text-[12px] font-medium text-foreground/90">{table.name}</span>
									<div className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">

										{normalized.length === 0 ? (
											<RowPinButton
												pinned={rowIsPinned(orderMap, `${tableContainerBase}::${section.kind}`, table.name)}
												onToggle={() => togglePin(`${tableContainerBase}::${section.kind}`, section.names, table.name)}
											/>
										) : null}
										<button
											type="button"
											aria-label={t("databaseAnalyzeTable.label")}
											title={t("databaseAnalyzeTable.label")}
											className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
											onClick={(event) => {
												event.stopPropagation();
												onAnalyzeTable(connection, table.name, scope);
											}}
										>
											<span className="h-3.5 w-3.5 icon-[lucide--wand-sparkles]" />
										</button>
										<button
											type="button"
											aria-label={t("databaseOpenTable")}
											title={t("databaseOpenTable")}
											className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
											onClick={(event) => {
												event.stopPropagation();
												void onOpenTable(connection, table.name, scope);
											}}
										>
											<span className="h-3.5 w-3.5 icon-[lucide--play]" />
										</button>
									</div>
								</ExplorerOrderableRow>
								{expanded ? (
									<div className="ml-[22px] pl-1.5">
										<ColumnRows
											node={columns}
										onRetry={() => explorer.actions.reloadColumns(connection.name, table.name, scope)}
											onContextMenu={(event, column) => onColumnContextMenu(event, column)}
										/>
										<TableObjectRows explorer={explorer} connection={connection} table={table.name} scope={scope} />
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			))}
		</>
	);
}

/**
 * 搜索时自动加载未展开连接的表数据（表名过滤依赖已加载表）。
 *
 * 原实现（V2）只展开 `visible` 快照，而表名过滤只对**已加载**表生效
 * （`filterConnections` 的表名匹配来自 `tablesOf(...).items`，未加载连接返回空）——
 * 未展开过的连接里的表永远搜不到。修复分两步：
 * ① 对所有连接自动触发表数据加载（未加载才加载，加载中不重复）；
 * ② 展开改为纯渲染态（V6-①）：searching 时 visible 连接一律展开，
 *    搜索结束自动恢复，不再用 toggleConnection 永久改写展开状态。
 */
function useAutoExpandOnSearch(
	explorer: DatabaseExplorerModel,
	allConnections: readonly DbConnection[],
	searching: boolean,
) {
	// 表名过滤依赖已加载表：搜索时对未加载连接自动取数，加载完成前不阻塞过滤。
	// 分层连接（PG schema / MySQL database）：先枚举 catalog 作用域，再对每个作用域取表；
	// flat 连接与改造前一致，直接取连接下的表。
	useEffect(() => {
		if (!searching) return;
		for (const connection of allConnections) {
			const family = catalogFamilyOfType(connection.type);
			if (family === "flat") {
				const node = explorer.tablesOf(connection.name);
				if (!node.loaded && !node.loading) {
					void explorer.actions.reloadTables(connection.name);
				}
				continue;
			}
			const scopeNode = explorer.scopesOf(connection.name);
			if (!scopeNode.loaded && !scopeNode.loading) {
				void explorer.actions.reloadScopes(connection.name, family);
				continue;
			}
			for (const scope of scopeNode.items) {
				const node = explorer.tablesOf(connection.name, scope);
				if (!node.loaded && !node.loading) {
					void explorer.actions.reloadTables(connection.name, scope);
				}
			}
		}
	}, [allConnections, explorer, searching]);
}

/** 连接 → 表 → 列 懒加载树（V2：sticky 搜索 + 状态点 + 右键菜单 + 分组折叠）。 */
export function DatabaseExplorerTree({
	connections,
	userGroups = [],
	onDeleteUserGroup,
	selectedName,
	explorer,
	statusOf,
	snapshotOf,
	onSelect,
	onOpenQuery,
	onOpenTable,
	onTestConnection,
	revealTarget,
	onAnalyzeTable,
	onTableCommand,
	onTableBatchCommand,
	tableBatchResetNonce = 0,
	tableBatchKeepKeys = [],

}: DatabaseExplorerTreeProps): JSX.Element {
	const { t } = useTranslation("settings");

	// V2-① sticky 搜索区：debounce 300ms，过滤连接名 / 已加载表名。
	// #7 工具条状态持久化：重启后恢复上次的搜索词 / 只看健康 / 种类过滤 / 排序。
	const [initialToolbar] = useState(loadExplorerToolbarState);
	const [searchInput, setSearchInput] = useState(initialToolbar.searchQuery);
	const [deferredQuery, setDeferredQuery] = useState(initialToolbar.searchQuery);
	useEffect(() => {
		const timer = window.setTimeout(() => setDeferredQuery(searchInput), SEARCH_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [searchInput]);

	const [healthyOnly, setHealthyOnly] = useState(initialToolbar.healthyOnly);
	const [sortOrder, setSortOrder] = useState<ConnectionSortOrder>(initialToolbar.sortOrder);
	const [kindFilter, setKindFilter] = useState<TableKindFilter>(initialToolbar.kindFilter);
	const [globalSearch, setGlobalSearch] = useState(initialToolbar.globalSearch);
	const [locateNonce, setLocateNonce] = useState(0);
	useEffect(() => {
		saveExplorerToolbarState({ searchQuery: searchInput, healthyOnly, globalSearch, sortOrder, kindFilter });
	}, [globalSearch, healthyOnly, kindFilter, searchInput, sortOrder]);
	const { visible } = useMemo(
		() =>
			filterConnections(
				healthyOnly ? connections.filter((connection) => statusOf(connection.name) === "ok") : connections,
				deferredQuery,
				// 表命中匹配：flat 连接查连接下表；分层连接合并各 catalog 作用域下已加载的表。
				(connection) => {
					if (catalogFamilyOfType(connection.type) === "flat") return explorer.tablesOf(connection.name).items;
					return explorer
						.scopesOf(connection.name)
						.items.flatMap((scope) => explorer.tablesOf(connection.name, scope).items);
				},
				// 作用域名命中匹配（P2 #8/#9 搜索对齐 dbx）：flat 连接无作用域。
				(connection) =>
					catalogFamilyOfType(connection.type) === "flat"
						? []
						: explorer.scopesOf(connection.name).items.map((scope) => scope.name),
			),
		[connections, deferredQuery, explorer, healthyOnly, statusOf],
	);
	const searching = deferredQuery.trim().length > 0;
	// 仅全局搜索开启时允许跨连接自动取数以扩大命中面；仅本地过滤（关闭）时只在已加载范围内匹配。
	useAutoExpandOnSearch(explorer, connections, searching && globalSearch);

	// 批次2-① 行置顶与拖拽重排：顺序按容器分桶（连接分组 / scope / 表分区）持久化本地。
	const [orderMap, setOrderMap] = useState<ExplorerOrderMap>(() => loadExplorerOrder());
	const updateOrderMap = useCallback((container: string, next: RowOrder) => {
		setOrderMap((prev) => {
			const merged = { ...prev, [container]: next };
			saveExplorerOrder(merged);
			return merged;
		});
	}, []);
	const rowOrderController = useMemo<ExplorerRowOrderController>(
		() => ({
			orderMap,
			togglePin: (container, names, name) => {
				updateOrderMap(container, toggleRowPin(orderMap[container] ?? EMPTY_ROW_ORDER, names, name));
			},
			moveRow: (container, names, from, to) => {
				updateOrderMap(container, moveRowAcross(orderMap[container] ?? EMPTY_ROW_ORDER, names, from, to));
			},
		}),
		[orderMap, updateOrderMap],
	);

	// 批次2-② 可见性过滤：右键「隐藏该库/模式/表」写 exclude（对该连接生效），
	// 连接菜单「显示全部对象」清除整条配置；即时生效并持久化。
	const [visibilityMap, setVisibilityMap] = useState<ExplorerVisibilityMap>(() => loadExplorerVisibility());
	const updateVisibility = useCallback((connectionName: string, next: ConnectionVisibility | undefined) => {
		setVisibilityMap((prev) => {
			const merged = { ...prev };
			if (next) merged[connectionName] = next;
			else delete merged[connectionName];
			saveExplorerVisibility(merged);
			return merged;
		});
	}, []);
	const hideScope = useCallback((connectionName: string, scopeName: string) => {
		setVisibilityMap((prev) => {
			const current = prev[connectionName]?.scopes;
			const next: ConnectionVisibility = {
				...(prev[connectionName] ?? {}),
				scopes: { include: current?.include ?? [], exclude: [...(current?.exclude ?? []), scopeName] },
			};
			const merged = { ...prev, [connectionName]: next };
			saveExplorerVisibility(merged);
			return merged;
		});
	}, []);
	const hideTable = useCallback((connectionName: string, tableName: string) => {
		setVisibilityMap((prev) => {
			const current = prev[connectionName]?.tables;
			const next: ConnectionVisibility = {
				...(prev[connectionName] ?? {}),
				tables: { include: current?.include ?? [], exclude: [...(current?.exclude ?? []), tableName] },
			};
			const merged = { ...prev, [connectionName]: next };
			saveExplorerVisibility(merged);
			return merged;
		});
	}, []);

	// V6-③ 定位当前表：点击工具条定位按钮后展开连接/schema/表并滚动到该表行（数据未就绪时轮询重试）。
	const handleLocateTable = () => {
		if (!revealTarget) return;
		setHealthyOnly(false);
		setSortOrder("default");
		setSearchInput("");
		setKindFilter("all");
		setLocateNonce((nonce) => nonce + 1);
		recordSettingsUsage({ tab: "database", action: "selected", target: "explorer-locate-table" });
	};
	// explorer/connections/revealTarget 每次渲染都是新引用：若放进 effect 依赖会让定位轮询在每次渲染后重启。
	// 重启的 interval 会再次无条件 expandScope/expandTable，把用户刚手动折叠的 schema 又强制展开（V6 折叠 bug）。
	// 改为经 ref 读最新值 + effect 仅依赖 locateNonce：只在点按钮时启动单轮 setTimeout 链，找到行或放弃后自然终止。
	const explorerRef = useRef(explorer);
	explorerRef.current = explorer;
	const connectionsRef = useRef(connections);
	connectionsRef.current = connections;
	const revealTargetRef = useRef(revealTarget);
	revealTargetRef.current = revealTarget;

	useEffect(() => {
		if (locateNonce === 0) return;
		const reveal = revealTargetRef.current;
		if (!reveal) return;
		const { connection: targetConnection, table, scope } = reveal;
		const target = connectionsRef.current.find((connection) => connection.name === targetConnection);
		if (!target) return;
		let cancelled = false;
		let attempts = 0;
		const step = () => {
			if (cancelled) return;
			attempts += 1;
			const current = explorerRef.current;
			const family = catalogFamilyOfType(target.type);
			// 已展开/已加载的不重复触发，避免无谓 setState 与多余请求。
			if (!current.isConnectionExpanded(targetConnection)) current.actions.expandConnection(targetConnection);
			let scopeObj: DbCatalogScope | null = null;
			if (family !== "flat" && scope) {
				const node = current.scopesOf(targetConnection);
				if (!node.loaded && !node.loading) current.actions.reloadScopes(targetConnection, family);
				const kind = family === "schemas" ? "schema" : "database";
				scopeObj = node.items.find((item) => item.name === scope && item.kind === kind) ?? null;
				if (scopeObj && !current.isScopeExpanded(targetConnection, scopeObj)) {
					current.actions.expandScope(targetConnection, scopeObj);
				}
			}
			if (family === "flat" || scopeObj) {
				const scopeArg = scopeObj ?? undefined;
				const tablesNode =
					family === "flat" ? current.tablesOf(targetConnection) : current.tablesOf(targetConnection, scopeArg);
				if (!tablesNode.loaded && !tablesNode.loading) {
					if (family === "flat") current.actions.reloadTables(targetConnection);
					else current.actions.reloadTables(targetConnection, scopeArg);
				}
				if (!current.isTableExpanded(targetConnection, table, scopeArg)) {
					current.actions.expandTable(targetConnection, table, scopeArg);
				}
			}
			const row = Array.from(document.querySelectorAll<HTMLElement>("[data-db-table]")).find((element) => {
				if (element.dataset.dbTable !== table) return false;
				const container = element.closest<HTMLElement>("[data-db-connection]");
				if (!container || container.dataset.dbConnection !== targetConnection) return false;
				return (element.dataset.dbScope ?? "") === (scope ?? "");
			});
			if (row) {
				row.scrollIntoView({ block: "nearest", behavior: "smooth" });
				return; // 找到即止，不再调度
			}
			if (attempts >= 30) return; // 放弃（~3.6s 未就绪）
			window.setTimeout(step, 120);
		};
		step();
		return () => {
			cancelled = true;
		};
	}, [locateNonce]);

	// V2-③ 分组：按 groupPath 首段分组，组头可折叠；非默认排序时组内按名称重排（对齐 dbx）。
	const defaultGroupLabel = t("databaseGroupDefault");
	const groups = useMemo(() => {
		const grouped = groupConnections(visible, defaultGroupLabel);
		// 用户自定义分组：与连接派生组同名则归并，否则按创建序置顶为空组（对齐 dbx「新建分组」）。
		const derivedNames = new Set(grouped.map((entry) => entry.group));
		const extra = userGroups
			.filter((name) => !derivedNames.has(name))
			.map((name) => ({ group: name, connections: [] as DbConnection[] }));
		const list = [...extra, ...grouped];
		if (sortOrder === "default") return list;
		return list.map((entry) => ({ ...entry, connections: sortConnectionsByName(entry.connections, sortOrder) }));
	}, [visible, defaultGroupLabel, sortOrder, userGroups]);

	// V2-② 右键菜单：记录触发位置与菜单项，由 DatabaseExplorerContextMenu 渲染。
	const [menu, setMenu] = useState<{ x: number; y: number; items: DatabaseContextMenuItem[] } | null>(null);

	const copyName = (label: string) => {
		void navigator.clipboard.writeText(label).catch(() => {});
		recordSettingsUsage({ tab: "database", action: "selected", target: "explorer-copy-name" });
	};

	/** 连接刷新：分层连接重枚举 catalog 作用域（scope 表数据随后懒加载重取）；flat 连接直接刷新表。 */
	const refreshConnection = (connection: DbConnection) => {
		const family = catalogFamilyOfType(connection.type);
		if (family === "flat") {
			explorer.actions.reloadTables(connection.name);
		} else {
			explorer.actions.reloadScopes(connection.name, family);
		}
	};

	const openConnectionMenu = (event: ReactMouseEvent, connection: DbConnection) => {
		event.preventDefault();
		event.stopPropagation();
		const expanded = explorer.isConnectionExpanded(connection.name);
		const items: DatabaseContextMenuItem[] = [
			{
				key: "toggle",
				icon: expanded ? "icon-[lucide--chevron-down]" : "icon-[lucide--chevron-right]",
				label: expanded ? t("databaseCollapse") : t("databaseExpand"),
				onSelect: () => explorer.actions.toggleConnection(connection.name),
			},
			{
				key: "refresh",
				icon: "icon-[lucide--refresh-cw]",
				label: t("databaseRefresh"),
				onSelect: () => {
					refreshConnection(connection);
					recordSettingsUsage({ tab: "database", action: "selected", target: "explorer-refresh" });
				},
			},
			...(onTestConnection
				? [
						{
							key: "test",
							icon: "icon-[lucide--plug-zap]",
							label: t("databaseTestConnection"),
							onSelect: () => void onTestConnection(connection.name),
						},
					]
				: []),
			{ key: "separator-1", separator: true },
			{
				key: "copy",
				icon: "icon-[lucide--copy]",
				label: t("databaseCopyName"),
				onSelect: () => copyName(connection.name),
			},

			{ key: "sep-show-all", separator: true },
			{
				key: "show-all",
				icon: "icon-[lucide--eye]",
				label: t("databaseShowAllObjects"),
				onSelect: () => updateVisibility(connection.name, undefined),
			},
		];
		setMenu({ x: event.clientX, y: event.clientY, items });
	};

	const openTableMenu = (event: ReactMouseEvent, connection: DbConnection, table: DbTableInfo, scope?: DbCatalogScope) => {
		event.preventDefault();
		event.stopPropagation();
		const expanded = explorer.isTableExpanded(connection.name, table.name, scope);
		// scope 限定名菜单项（仅分层连接显示）——单独声明以保持字面量类型（separator: true）不拓宽
		const qualifiedItems: DatabaseContextMenuItem[] = scope
			? [
					{ key: "separator-2", separator: true },
					{
						key: "copy-qualified",
						icon: "icon-[lucide--copy]",
						label: t("databaseCopyQualifiedName"),
						onSelect: () => copyName(qualifiedTableName(table.name, scope)),
					},
				]
			: [];
		const items: DatabaseContextMenuItem[] = [
			{
				key: "open",
				icon: "icon-[lucide--play]",
				label: t("databaseOpenTable"),
				onSelect: () => void onOpenTable(connection, table.name, scope),
			},
			{
				key: "analyze",
				icon: "icon-[lucide--wand-sparkles]",
				label: t("databaseAnalyzeTable.label"),
				onSelect: () => onAnalyzeTable(connection, table.name, scope),
			},
			{
				key: "toggle",
				icon: expanded ? "icon-[lucide--chevron-down]" : "icon-[lucide--chevron-right]",
				label: expanded ? t("databaseCollapse") : t("databaseExpand"),
				onSelect: () => explorer.actions.toggleTable(connection.name, table.name, scope),
			},
			{
				key: "refresh",
				icon: "icon-[lucide--refresh-cw]",
				label: t("databaseRefresh"),
				onSelect: () => explorer.actions.reloadColumns(connection.name, table.name, scope),
			},
			{
				key: "copy",
				icon: "icon-[lucide--copy]",
				label: t("databaseCopyName"),
				onSelect: () => copyName(table.name),
			},
		...qualifiedItems,

			{ key: "sep-hide-table", separator: true },
			{
				key: "hide-table",
				icon: "icon-[lucide--eye-off]",
				label: t("databaseHideTable"),
				onSelect: () => hideTable(connection.name, table.name),
			},
			{ key: "sep-table-tools", separator: true },
			{
				key: "export-csv",
				icon: "icon-[lucide--file-text]",
				label: t("databaseExportCsv"),
				onSelect: () => onTableCommand?.({ kind: "exportCsv", connection, table, scope }),
			},
			{
				key: "export-json",
				icon: "icon-[lucide--file-json-2]",
				label: t("databaseExportJson"),
				onSelect: () => onTableCommand?.({ kind: "exportJson", connection, table, scope }),
			},
			{ key: "sep-table-danger", separator: true },
			{
				key: "truncate-table",
				icon: "icon-[lucide--rotate-ccw]",
				label: t("databaseTruncateTable"),
				destructive: true,
				onSelect: () => onTableCommand?.({ kind: "truncate", connection, table, scope }),
			},
			{
				key: "rename-table",
				icon: "icon-[lucide--square-pen]",
				label: t("databaseRenameTable"),
				onSelect: () => onTableCommand?.({ kind: "rename", connection, table, scope }),
			},
			{
				key: "drop-table",
				icon: "icon-[lucide--trash-2]",
				label: t("databaseDropTable"),
				destructive: true,
				onSelect: () => onTableCommand?.({ kind: "drop", connection, table, scope }),
			},
		];
		setMenu({ x: event.clientX, y: event.clientY, items });
	};

	const openColumnMenu = (event: ReactMouseEvent, column: DbColumnInfo) => {
		event.preventDefault();
		event.stopPropagation();
		const items: DatabaseContextMenuItem[] = [
			{
				key: "copy",
				icon: "icon-[lucide--copy]",
				label: t("databaseCopyColumnName"),
				onSelect: () => copyName(column.name),
			},
		];
		setMenu({ x: event.clientX, y: event.clientY, items });
	};

	const openScopeMenu = (event: ReactMouseEvent, connection: DbConnection, scope: DbCatalogScope) => {
		event.preventDefault();
		event.stopPropagation();
		const expanded = explorer.isScopeExpanded(connection.name, scope);
		const items: DatabaseContextMenuItem[] = [
			{
				key: "toggle",
				icon: expanded ? "icon-[lucide--chevron-down]" : "icon-[lucide--chevron-right]",
				label: expanded ? t("databaseCollapse") : t("databaseExpand"),
				onSelect: () => explorer.actions.toggleScope(connection.name, scope),
			},
			{
				key: "refresh",
				icon: "icon-[lucide--refresh-cw]",
				label: t("databaseRefresh"),
				onSelect: () => explorer.actions.reloadTables(connection.name, scope),
			},
			{ key: "separator-1", separator: true },
			{
				key: "copy",
				icon: "icon-[lucide--copy]",
				label: t("databaseCopyName"),
				onSelect: () => copyName(scope.name),
			},

			{ key: "sep-hide-scope", separator: true },
			{
				key: "hide-scope",
				icon: "icon-[lucide--eye-off]",
				label: t(scope.kind === "schema" ? "databaseHideSchema" : "databaseHideDatabase"),
				onSelect: () => hideScope(connection.name, scope.name),
			},
		];
		setMenu({ x: event.clientX, y: event.clientY, items });
	};

	// P1-6 分组行右键：展开/折叠组内全部连接（对齐 dbx 分组操作，新建分组需写回暂不做）。
	const openGroupMenu = (event: ReactMouseEvent, group: string, groupConnections: readonly DbConnection[]) => {
		event.preventDefault();
		event.stopPropagation();
		const items: DatabaseContextMenuItem[] = [
			{
				key: "expand-all",
				icon: "icon-[lucide--chevrons-down]",
				label: t("databaseExpandAll"),
				onSelect: () => explorer.actions.expandConnections(groupConnections.map((connection) => connection.name)),
			},
			{
				key: "collapse-all",
				icon: "icon-[lucide--chevrons-up]",
				label: t("databaseCollapseAll"),
				onSelect: () => explorer.actions.collapseConnections(groupConnections.map((connection) => connection.name)),
			},
			{ key: "separator-1", separator: true },
			{
				key: "copy-group",
				icon: "icon-[lucide--copy]",
				label: t("databaseCopyName"),
				onSelect: () => copyName(group),
			},
			...(userGroups.includes(group)
				? [
						{ key: "sep-user-group", separator: true } as const,
						{
							key: "delete-group",
							icon: "icon-[lucide--folder-x]",
							label: t("databaseDeleteGroup"),
							destructive: true,
							onSelect: () => onDeleteUserGroup?.(group),
						} as const,
				  ]
				: []),
		];
		setMenu({ x: event.clientX, y: event.clientY, items });
	};

	// ---- V2-① 连接吸顶条（轻量版）：滚动时在工具条下沿显示当前置顶的展开连接名，对齐 dbx sticky header。
	// height:0 + sticky 的“不占位钉住”手法避免吸顶条出现/消失时内容跳动。
	const treeRootRef = useRef<HTMLDivElement>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const rafRef = useRef<number | null>(null);
	const [toolbarHeight, setToolbarHeight] = useState(0);
	// bar 内容 key："group\u0000connection"；null = 不显示。同值比较避免每帧重渲染。
	const [stickyKey, setStickyKey] = useState<string | null>(null);
	const computeSticky = useCallback(() => {
		const root = treeRootRef.current;
		let next: string | null = null;
		if (root) {
			// DOM 顺序即视觉顺序（自上而下），命中的是“最后一个已贴上工具条下沿”的连接头。
			const nodes = root.querySelectorAll<HTMLElement>('[data-db-connection][data-db-expanded="true"]');
			for (const el of nodes) {
				const rect = el.getBoundingClientRect();
				if (rect.top <= toolbarHeight + 1) {
					next = `${el.dataset.dbGroup ?? ""}\u0000${el.dataset.dbConnection ?? ""}`;
				} else {
					break;
				}
			}
		}
		setStickyKey((prev) => (prev === next ? prev : next));
	}, [toolbarHeight]);
	// 测量工具条高度；capture 阶段监听滚动（取到树所在滚动容器）；展开/折叠/搜索等布局变化经 ResizeObserver 重算。
	useLayoutEffect(() => {
		const toolbar = toolbarRef.current;
		const root = treeRootRef.current;
		if (!toolbar || !root) {
			return;
		}
		setToolbarHeight(toolbar.offsetHeight);
		const onScroll = (event: Event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement) || !target.contains(root)) {
				return;
			}
			if (rafRef.current === null) {
				rafRef.current = requestAnimationFrame(() => {
					rafRef.current = null;
					computeSticky();
				});
			}
		};
		const observer = new ResizeObserver(() => {
			setToolbarHeight(toolbar.offsetHeight);
			computeSticky();
		});
		observer.observe(toolbar);
		observer.observe(root);
		document.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("scroll", onScroll, true);
			observer.disconnect();
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		};
	}, [computeSticky]);
	const stickyParts = stickyKey === null ? null : stickyKey.split("\u0000");

	// ---- V2-④ 多选（对齐 dbx）：无常驻开关，勾选即激活（multiActive = 有勾选），清空即退出。
	//      多选仅由行尾 hover 勾选框管理；批量复制/批量测试走行安全操作。 ----
	const [multiNames, setMultiNames] = useState<readonly string[]>([]);
	const multiCount = multiNames.length;
	const multiActive = multiCount > 0;
	const toggleMultiName = (name: string) => {
		setMultiNames((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]));
	};
	const copySelectedNames = () => {
		if (multiCount === 0) {
			return;
		}
		void navigator.clipboard.writeText(multiNames.join("\n")).catch(() => {});
		recordSettingsUsage({ tab: "database", action: "selected", target: "explorer-copy-names" });
	};
	const testSelectedConnections = () => {
		if (!onTestConnection) {
			return;
		}
		for (const name of multiNames) {
			void onTestConnection(name);
		}
	};

	const allConnectionNames = groups.flatMap(({ connections }) => connections.map((connection) => connection.name));
	const allChecked = multiCount > 0 && allConnectionNames.every((name) => multiNames.includes(name));
	const toggleAllConnections = () => {
		setMultiNames(allChecked ? [] : allConnectionNames);
	};

	// ---- 批次3 #16 表批量多选（对齐 dbx 对象浏览器）：表行行尾 hover 勾选，勾选即激活批量动作条。
	//      跨连接勾选会清空其它连接的已选表（命令按连接分组逐表执行）；视图仅参与导出，不参与清空/删除。 ----
	const [tableMultiMap, setTableMultiMap] = useState<ReadonlyMap<string, TableBatchTarget>>(() => new Map());
	const tableMultiCount = tableMultiMap.size;
	const tableMultiActive = tableMultiCount > 0;
	const tableMultiValues = useMemo(() => [...tableMultiMap.values()], [tableMultiMap]);
	const tableMultiHasNonView = tableMultiValues.some((item) => !item.view);
	const tableMultiToggle = useCallback(
		(connection: DbConnection, table: string, scope: DbCatalogScope | undefined, view: boolean) => {
			const key = tableSelectionKey(connection, table, scope);
			setTableMultiMap((prev) => {
				const next = new Map(prev);
				if (next.has(key)) {
					next.delete(key);
					return next;
				}
				const first = next.values().next().value;
				if (first && first.connection.name !== connection.name) {
					next.clear();
				}
				next.set(key, { connection, table, scope, view });
				return next;
			});
		},
		[],
	);
	const tableMultiClear = useCallback(() => setTableMultiMap(() => new Map()), []);
	const lastTableBatchReset = useRef(0);
	useEffect(() => {
		if (tableBatchResetNonce > 0 && tableBatchResetNonce !== lastTableBatchReset.current) {
			lastTableBatchReset.current = tableBatchResetNonce;
			setTableMultiMap((prev) => {
				if (tableBatchKeepKeys.length === 0) {
					return new Map();
				}
				const keep = new Set(tableBatchKeepKeys);
				const next = new Map();
				for (const [key, value] of prev) {
					if (keep.has(key)) {
						next.set(key, value);
					}
				}
				return next;
			});
		}
	}, [tableBatchKeepKeys, tableBatchResetNonce]);
	const tableMultiCtx = useMemo<TableMultiContextValue>(
		() => ({ map: tableMultiMap, active: tableMultiActive, toggle: tableMultiToggle, clear: tableMultiClear }),
		[tableMultiActive, tableMultiClear, tableMultiMap, tableMultiToggle],
	);
	const fireTableBatch = (action: TableBatchAction) => {
		if (!onTableBatchCommand || tableMultiCount === 0) {
			return;
		}
		const targets =
			action === "exportCsv" || action === "exportJson" ? tableMultiValues : tableMultiValues.filter((item) => !item.view);
		if (targets.length === 0) {
			return;
		}
		recordSettingsUsage({ tab: "database", action: "selected", target: `explorer-batch-${action}` });
		onTableBatchCommand({ action, targets });
	};

	return (
		<ExplorerRowOrderContext.Provider value={rowOrderController}>
		<TableMultiContext.Provider value={tableMultiCtx}>
		<div ref={treeRootRef} className="space-y-0.5">
			{/* V2-① sticky 搜索区：跟随列表滚动，悬浮于树内容之上 */}
			<div ref={toolbarRef} className="sticky top-0 z-10 -mx-1 bg-muted/95 px-1 pb-1.5 pt-0.5 backdrop-blur-sm">
				<div className="relative">
					<span className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60 icon-[lucide--search]" />
					<input
						type="text"
						value={searchInput}
						onChange={(event) => setSearchInput(event.target.value)}
						placeholder={t("databaseSearchConnections")}
						aria-label={t("databaseSearchConnections")}
						className="h-7 w-full rounded-md border border-border/60 bg-background pl-7 pr-6 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
					/>
					{searchInput ? (
						<button
							type="button"
							aria-label={t("databaseClearSearch")}
							title={t("databaseClearSearch")}
							className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
							onClick={() => setSearchInput("")}
						>
							<span className="h-3 w-3 icon-[lucide--x]" />
						</button>
					) : null}
				</div>

				<div className="mt-1 flex items-center gap-1">
					<button
						type="button"
						aria-pressed={globalSearch}
						aria-label={t("databaseGlobalSearch")}
						title={t("databaseGlobalSearch")}
						className={cn(
							"flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-background hover:text-foreground",
							globalSearch && "bg-primary/10 text-primary hover:text-primary",
						)}
						onClick={() => setGlobalSearch((prev) => !prev)}
					>
						<span className="h-3.5 w-3.5 icon-[lucide--globe]" />
					</button>
					<button
						type="button"
						aria-pressed={healthyOnly}
						aria-label={t("databaseOnlyHealthy")}
						title={t("databaseOnlyHealthy")}
						className={cn(
							"flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-background hover:text-foreground",
							healthyOnly && "bg-primary/10 text-primary hover:text-primary",
						)}
						onClick={() => setHealthyOnly((prev) => !prev)}
					>
						<span className="h-3.5 w-3.5 icon-[lucide--heart-pulse]" />
					</button>
					<button
						type="button"
						aria-label={t("databaseKindFilter")}
						title={t("databaseKindFilter")}
						className={cn(
							"flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-background hover:text-foreground",
							kindFilter !== "all" && "bg-primary/10 text-primary hover:text-primary",
						)}
						onClick={(event) => {
							event.stopPropagation();
							const rect = event.currentTarget.getBoundingClientRect();
							const options = [
								{ filter: "all" as const, icon: "icon-[lucide--layout-grid]", label: t("databaseKindAll") },
								{ filter: "tables" as const, icon: "icon-[lucide--table-2]", label: t("databaseKindTablesOnly") },
								{ filter: "views" as const, icon: "icon-[lucide--eye]", label: t("databaseKindViewsOnly") },
							];
							const items: DatabaseContextMenuItem[] = options.map((option) => ({
								key: option.filter,
								icon: option.icon,
								label: option.label,
								checked: kindFilter === option.filter,
								onSelect: () => setKindFilter(option.filter),
							}));
							setMenu({ x: rect.left, y: rect.bottom + 4, items });
						}}
					>
						<span className="h-3.5 w-3.5 icon-[lucide--list-filter]" />
					</button>
					<button
						type="button"
						aria-label={t("databaseSort")}
						title={t("databaseSort")}
						className={cn(
							"flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-background hover:text-foreground",
							sortOrder !== "default" && "bg-primary/10 text-primary hover:text-primary",
						)}
						onClick={(event) => {
							event.stopPropagation();
							const rect = event.currentTarget.getBoundingClientRect();
							const options = [
								{ order: "default" as const, icon: "icon-[lucide--arrow-up-down]", label: t("databaseSortDefault") },
								{ order: "asc" as const, icon: "icon-[lucide--arrow-up-a-z]", label: t("databaseSortAsc") },
								{ order: "desc" as const, icon: "icon-[lucide--arrow-down-z-a]", label: t("databaseSortDesc") },
							];
							const items: DatabaseContextMenuItem[] = options.map((option) => ({
								key: option.order,
								icon: option.icon,
								label: option.label,
								checked: sortOrder === option.order,
								onSelect: () => setSortOrder(option.order),
							}));
							setMenu({ x: rect.left, y: rect.bottom + 4, items });
						}}
					>
						<span className="h-3.5 w-3.5 icon-[lucide--arrow-up-down]" />
					</button>
					<button
						type="button"
						aria-label={t("databaseLocateActiveTable")}
						title={t("databaseLocateActiveTable")}
						disabled={!revealTarget}
						className={cn(
							"flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-background hover:text-foreground",
							!revealTarget && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground/70",
						)}
						onClick={() => handleLocateTable()}
					>
						<span className="h-3.5 w-3.5 icon-[lucide--crosshair]" />
					</button>

				</div>

				{multiActive ? (
					<div className="mt-1.5 flex items-center gap-0.5 rounded-md bg-background/80 px-1.5 py-1">
						<span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
							{t("databaseMultiSelectedCount", { count: multiCount })}
						</span>
						<button
							type="button"
							aria-label={allChecked ? t("databaseDeselectAll") : t("databaseSelectAll")}
							title={allChecked ? t("databaseDeselectAll") : t("databaseSelectAll")}
							className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
							onClick={toggleAllConnections}
						>
							<span className={cn("h-3 w-3", allChecked ? "icon-[lucide--check]" : "icon-[lucide--minus]")} />
						</button>
						<button
							type="button"
							aria-label={t("databaseCopyNames")}
							title={t("databaseCopyNames")}
							className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
							onClick={copySelectedNames}
						>
							<span className="h-3 w-3 icon-[lucide--copy]" />
						</button>
						{onTestConnection ? (
							<button
								type="button"
								aria-label={t("databaseTestConnection")}
								title={t("databaseTestConnection")}
								className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
								onClick={testSelectedConnections}
							>
								<span className="h-3 w-3 icon-[lucide--plug-zap]" />
							</button>
						) : null}
						<button
							type="button"
							aria-label={t("databaseClearSelection")}
							title={t("databaseClearSelection")}
							className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
							onClick={() => setMultiNames([])}
						>
							<span className="h-3 w-3 icon-[lucide--x]" />
						</button>
					</div>
				) : null}

				{/* 批次3 #16 表批量动作条：勾选任意表后出现（对齐 dbx 对象浏览器）。导出含视图；清空/删除仅表。 */}
				{tableMultiActive ? (
					<div className="mt-1.5 flex items-center gap-0.5 rounded-md bg-background/80 px-1.5 py-1">
						<span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
							{t("databaseTableMultiSelectedCount", { count: tableMultiCount })}
						</span>
						<button
							type="button"
							aria-label={t("databaseTableBatchExportCsv")}
							title={t("databaseTableBatchExportCsv")}
							className="flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-[11px] font-medium text-muted-foreground/80 hover:bg-muted hover:text-foreground"
							onClick={() => fireTableBatch("exportCsv")}
						>
							<span className="h-3 w-3 icon-[lucide--file-text]" />
							CSV
						</button>
						<button
							type="button"
							aria-label={t("databaseTableBatchExportJson")}
							title={t("databaseTableBatchExportJson")}
							className="flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-[11px] font-medium text-muted-foreground/80 hover:bg-muted hover:text-foreground"
							onClick={() => fireTableBatch("exportJson")}
						>
							<span className="h-3 w-3 icon-[lucide--file-json-2]" />
							JSON
						</button>
						<button
							type="button"
							aria-label={t("databaseTableBatchTruncate")}
							title={t("databaseTableBatchTruncate")}
							disabled={!tableMultiHasNonView}
							className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-red-600/80 hover:bg-red-600/10 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-red-600/80"
							onClick={() => fireTableBatch("truncate")}
						>
							<span className="h-3 w-3 icon-[lucide--rotate-ccw]" />
						</button>
						<button
							type="button"
							aria-label={t("databaseTableBatchDrop")}
							title={t("databaseTableBatchDrop")}
							disabled={!tableMultiHasNonView}
							className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-red-600/80 hover:bg-red-600/10 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-red-600/80"
							onClick={() => fireTableBatch("drop")}
						>
							<span className="h-3 w-3 icon-[lucide--trash-2]" />
						</button>
						<button
							type="button"
							aria-label={t("databaseClearSelection")}
							title={t("databaseClearSelection")}
							className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
							onClick={() => tableMultiClear()}
						>
							<span className="h-3 w-3 icon-[lucide--x]" />
						</button>
					</div>
				) : null}
			</div>

			{/* V2-① 连接吸顶条：滚动中在工具条下沿钉住当前置顶的展开连接名。height:0 + sticky = 不占位钉住，无跳动。 */}
			{stickyParts ? (
				<div className="sticky z-[9] -mx-1 px-1" style={{ top: toolbarHeight, height: 0 }}>
					<div className="pointer-events-none flex items-center gap-1.5 overflow-hidden rounded-md bg-muted/95 px-2 py-1 backdrop-blur-sm">
						<span className="h-3 w-3 shrink-0 text-muted-foreground/70 icon-[lucide--database]" />
						<span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-foreground">
							{stickyParts[1] ?? ""}
						</span>
						{stickyParts[0] ? (
							<span className="shrink-0 truncate text-[10px] font-medium text-muted-foreground/60">
								{stickyParts[0]}
							</span>
						) : null}
					</div>
				</div>
			) : null}

			{groups.length === 0 ? (
				<div className="px-2 py-4 text-center text-[12px] text-muted-foreground/60">
					{t(searching ? "databaseNoSearchResults" : "databaseNoHealthyConnections")}
				</div>
			) : (
				groups.map(({ group, connections: groupConnections }) => {
					// 搜索时忽略组折叠：组内连接可能命中过滤结果，折叠组隐藏会“搜到却看不到”。
					const collapsed = searching ? false : explorer.isGroupCollapsed(group);

					const groupContainer = groupConnections[0] ? connectionRowContainer(groupConnections[0]) : "";
					const groupNames = groupConnections.map((connection) => connection.name);
					const orderedGroupConnections =
						sortOrder === "default" ? applyOrderToItems(groupConnections, orderMap[groupContainer]) : groupConnections;
					return (
						<div key={group}>
							<button
								type="button"
								className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-background/60"
								onClick={() => explorer.actions.toggleGroup(group)}
								onContextMenu={(event) => openGroupMenu(event, group, groupConnections)}
								aria-expanded={!collapsed}
							>
								<span className={cn("h-3 w-3 shrink-0 transition-transform text-muted-foreground/60", !collapsed && "rotate-90", "icon-[lucide--chevron-right]")} />
								<span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
									{group}
								</span>
								<span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground/50">{groupConnections.length}</span>
							</button>
							{!collapsed ? (
								<div className="space-y-0.5 pl-[7px]">
									{orderedGroupConnections.map((connection) => {
										const expanded = searching || explorer.isConnectionExpanded(connection.name);
										const selected = connection.name === selectedName;

										const checked = multiNames.includes(connection.name);
										const snapshot = snapshotOf?.(connection.name) ?? null;
										const statusTitle =
											snapshot && snapshot.testedAt
												? [new Date(snapshot.testedAt).toLocaleTimeString(), snapshot.detail]
														.filter((part) => part !== "")
														.join(" · ")
												: undefined;
										return (
											<div key={connection.name}>
										<ExplorerOrderableRow
											container={groupContainer}
											name={connection.name}
											names={groupNames}
											disabled={sortOrder !== "default"}
											data-db-connection={connection.name}
											data-db-expanded={expanded ? "true" : "false"}
											data-db-group={group}
											className={cn(
												"group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2",
												multiActive
													? checked
														? "bg-primary/10 ring-1 ring-inset ring-primary/25"
														: "hover:bg-background/60"
													: selected
														? "bg-background shadow-sm"
														: "hover:bg-background/60",
											)}
											onClick={() => {
												// 对齐 dbx：点行 = 单选并退出多选；多选仅由行尾勾选框管理。
												if (multiActive) {
													setMultiNames([]);
												}
												onSelect(connection.name);
											}}
											onDoubleClick={() => onOpenQuery(connection)}
											onContextMenu={(event) => openConnectionMenu(event, connection)}
										>

												<button
													type="button"
													aria-label={expanded ? t("databaseCollapse") : t("databaseExpand")}
													className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/70"
													onClick={(event) => {
														event.stopPropagation();
														explorer.actions.toggleConnection(connection.name);
													}}
												>
													<span className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90", "icon-[lucide--chevron-right]")} />
												</button>
												<DatabaseTypeBadge type={connection.type} size="sm" />
												<span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground">{connection.name}</span>
												{connection.env === "prod" ? (
													<span
														title={t("databaseEnvProd")}
														className="shrink-0 rounded-[4px] bg-amber-500/10 px-1 py-px text-[9px] font-bold uppercase leading-4 tracking-wide text-amber-600 ring-1 ring-inset ring-amber-500/25"
													>
														prod
													</span>
												) : null}
												{/* 对齐 dbx：行尾唯一 hover 控件 = 多选 checkbox（点击即进入多选并勾选）；刷新/复制/测试均在右键菜单。 */}
												<DatabaseStatusDot status={statusOf(connection.name)} title={statusTitle} />
												<button
													type="button"
													aria-label={checked ? t("databaseDeselectConnection") : t("databaseSelectConnection")}
													title={checked ? t("databaseDeselectConnection") : t("databaseSelectConnection")}
																		className={cn(
																			"ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/55 opacity-0 transition-opacity hover:bg-secondary/45 hover:text-foreground focus-visible:opacity-100",
																			checked ? "opacity-100 text-primary" : multiActive ? "opacity-100" : "group-hover:opacity-100",
																		)}
																	onClick={(event) => {
																		event.stopPropagation();
																		// 对齐 dbx：点击勾选框 = 直接勾选/取消，有勾选自动进入多选态（无独立开关）。
																		toggleMultiName(connection.name);
																	}}
																>
																	<span className={cn("h-3 w-3", checked ? "icon-[lucide--square-check-big]" : "icon-[lucide--square]")} />
												</button>

												{sortOrder === "default" ? (
													<RowPinButton
														pinned={rowIsPinned(orderMap, groupContainer, connection.name)}
														onToggle={() => rowOrderController.togglePin(groupContainer, groupNames, connection.name)}
													/>
												) : null}
										</ExplorerOrderableRow>
											{expanded ? (
												<div className="ml-[13px] pl-1.5">
													{catalogFamilyOfType(connection.type) === "flat" ? (
														<TableRows
															connection={connection}
															explorer={explorer}
															onOpenTable={onOpenTable}
															onAnalyzeTable={onAnalyzeTable}
															onContextMenu={openTableMenu}
															onColumnContextMenu={openColumnMenu}
															searchQuery={deferredQuery}
															kindFilter={kindFilter}

															visibility={visibilityMap[connection.name]}
														/>
													) : (
														<ScopeRows
															connection={connection}
															family={catalogFamilyOfType(connection.type)}
															explorer={explorer}
															onOpenTable={onOpenTable}
															onAnalyzeTable={onAnalyzeTable}
															onScopeContextMenu={openScopeMenu}
															onTableContextMenu={openTableMenu}
															onColumnContextMenu={openColumnMenu}
															searchQuery={deferredQuery}
															searching={searching}
															kindFilter={kindFilter}

															visibility={visibilityMap[connection.name]}
														/>
													)}
												</div>
											) : null}
											</div>
										);
									})}
								</div>
							) : null}
						</div>
					);
				})
			)}

			{menu ? <DatabaseExplorerContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
		</div>
		</TableMultiContext.Provider>
		</ExplorerRowOrderContext.Provider>
	);
}
