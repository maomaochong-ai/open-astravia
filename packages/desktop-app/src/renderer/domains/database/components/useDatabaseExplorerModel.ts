import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	DbCatalogFamily,
	DbCatalogScope,
	DbColumnInfo,
	DbTableInfo,
} from "../../../../preload/api-types/database";
import { describeTable, listCatalogScopes, listTables } from "../lib/database-api";
import { formatDatabaseError } from "../lib/database-error-labels";

/** 懒加载列表节点（作用域 / 表 / 列共用）：loaded 标记是否已取数，error 为可展示文案。 */
export interface ExplorerListNode<T> {
	readonly loaded: boolean;
	readonly loading: boolean;
	readonly error: string | null;
	readonly items: readonly T[];
}

const EMPTY_NODE = { loaded: false, loading: false, error: null, items: [] as const } as const;

/** 树展开/折叠状态的本地持久化（对齐 dbx 会话恢复）：读写失败一律静默降级为内存态。 */
const STORAGE_PREFIX = "astravia.db.explorer.v1";
type ExpansionSet = Readonly<Record<string, true>>;

function storageAvailable(): boolean {
	try {
		return typeof window !== "undefined" && window.localStorage !== undefined;
	} catch {
		return false;
	}
}

function loadSet(field: string): ExpansionSet {
	if (!storageAvailable()) return {};
	try {
		const raw = window.localStorage.getItem(`${STORAGE_PREFIX}.${field}`);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const set: Record<string, true> = {};
		for (const [name, value] of Object.entries(parsed)) {
			if (value === true) set[name] = true;
		}
		return set;
	} catch {
		return {};
	}
}

function saveSet(field: string, value: ExpansionSet): void {
	if (!storageAvailable()) return;
	try {
		window.localStorage.setItem(`${STORAGE_PREFIX}.${field}`, JSON.stringify(value));
	} catch {
		// 忽略隐私模式/配额等写入失败
	}
}

/**
 * 表/列缓存键的作用域化：
 * - 无 scope（flat 连接或历史调用）：与改造前完全一致（connection / connection::table）；
 * - 有 scope（PG schema / MySQL database）：作用域参与键，互不串数据。
 */
function listKey(connection: string, scope?: DbCatalogScope): string {
	return scope ? `${connection}::${scope.kind}:${scope.name}` : connection;
}

function tableKey(connection: string, table: string, scope?: DbCatalogScope): string {
	return `${listKey(connection, scope)}::${table}`;
}

export interface DatabaseExplorerModel {
	readonly tablesOf: (connection: string, scope?: DbCatalogScope) => ExplorerListNode<DbTableInfo>;
	readonly columnsOf: (connection: string, table: string, scope?: DbCatalogScope) => ExplorerListNode<DbColumnInfo>;
	/** catalog 中间层（schema / database）节点，按连接存。 */
	readonly scopesOf: (connection: string) => ExplorerListNode<DbCatalogScope>;
	readonly isConnectionExpanded: (connection: string) => boolean;
	readonly isTableExpanded: (connection: string, table: string, scope?: DbCatalogScope) => boolean;
	/** catalog 中间层节点展开态。 */
	readonly isScopeExpanded: (connection: string, scope: DbCatalogScope) => boolean;
	/** V2-③ 分组折叠：分组名 → 是否折叠（折叠时隐藏组内连接）。 */
	readonly isGroupCollapsed: (group: string) => boolean;
	readonly actions: {
		readonly toggleConnection: (connection: string) => void;
		/** 纯展开连接（分层连接用：scope 列表在 ScopeRows 渲染时自行确保加载）。 */
		readonly expandConnection: (connection: string) => void;
		/** 纯折叠连接。 */
		readonly collapseConnection: (connection: string) => void;
		/** 确保 catalog 作用域已取数（未加载/未失败才加载）。 */
		readonly ensureScopes: (connection: string, family: DbCatalogFamily) => void;
		/** 强制重新枚举 catalog 作用域（ScopeRows 失败重试用）。 */
		readonly reloadScopes: (connection: string, family: DbCatalogFamily) => void;
		/** 展开/折叠 catalog 中间层节点（首次展开触发该作用域表懒加载）。 */
		readonly toggleScope: (connection: string, scope: DbCatalogScope) => void;
		/** 定位用：幂等展开 scope（不折叠），首次展开确保该作用域表已取数。 */
		readonly expandScope: (connection: string, scope: DbCatalogScope) => void;
		readonly toggleTable: (connection: string, table: string, scope?: DbCatalogScope) => void;
		/** 定位用：幂等展开表（不折叠），首次展开确保列已取数。 */
		readonly expandTable: (connection: string, table: string, scope?: DbCatalogScope) => void;
		readonly reloadTables: (connection: string, scope?: DbCatalogScope) => void;
		/** 确保表已取数（子节点挂载时触发；未加载/未失败才加载）。 */
		readonly ensureTables: (connection: string, scope?: DbCatalogScope) => void;
		readonly reloadColumns: (connection: string, table: string, scope?: DbCatalogScope) => void;
		readonly toggleGroup: (group: string) => void;
		/** P1-6 分组右键：展开/折叠组内全部连接（含懒加载表）。 */
		readonly expandConnections: (connections: readonly string[]) => void;
		readonly collapseConnections: (connections: readonly string[]) => void;
	};
}

/**
 * 连接 → [catalog 中间层] → 表 → 列 的懒加载树状态（B2.6 + V2 分组折叠 + P2 #8/#9 分层）。
 * 展开才取数，失败可重试。非分层连接（family "flat"）行为与改造前完全一致。
 */
export function useDatabaseExplorerModel(): DatabaseExplorerModel {
	const { t } = useTranslation("settings");

	const [expandedConnections, setExpandedConnections] = useState<Readonly<Record<string, true>>>(() =>
		loadSet("expandedConnections"),
	);
	const [expandedScopes, setExpandedScopes] = useState<Readonly<Record<string, true>>>(() =>
		loadSet("expandedScopes"),
	);
	const [expandedTables, setExpandedTables] = useState<Readonly<Record<string, true>>>(() =>
		loadSet("expandedTables"),
	);
	const [collapsedGroups, setCollapsedGroups] = useState<Readonly<Record<string, true>>>(() =>
		loadSet("collapsedGroups"),
	);
	const [tables, setTables] = useState<Readonly<Record<string, ExplorerListNode<DbTableInfo>>>>({});
	const [columns, setColumns] = useState<Readonly<Record<string, ExplorerListNode<DbColumnInfo>>>>({});
	const [scopes, setScopes] = useState<Readonly<Record<string, ExplorerListNode<DbCatalogScope>>>>({});
	// 展开/折叠状态持久化：重启后恢复（对齐 dbx 会话恢复体验）。
	useEffect(() => saveSet("expandedConnections", expandedConnections), [expandedConnections]);
	useEffect(() => saveSet("expandedScopes", expandedScopes), [expandedScopes]);
	useEffect(() => saveSet("expandedTables", expandedTables), [expandedTables]);
	useEffect(() => saveSet("collapsedGroups", collapsedGroups), [collapsedGroups]);

	const loadTables = useCallback(
		async (connection: string, scope?: DbCatalogScope) => {
			const key = listKey(connection, scope);
			setTables((prev) => ({
				...prev,
				[key]: { ...(prev[key] ?? EMPTY_NODE), loading: true, error: null },
			}));
			try {
				const items = await listTables(
					connection,
					scope ? { [scope.kind === "schema" ? "schema" : "database"]: scope.name } : undefined,
				);
				setTables((prev) => ({ ...prev, [key]: { loaded: true, loading: false, error: null, items } }));
			} catch (caught) {
				const { message } = formatDatabaseError(t, caught);
				setTables((prev) => ({
					...prev,
					[key]: { ...(prev[key] ?? EMPTY_NODE), loading: false, error: message },
				}));
			}
		},
		[t],
	);

	const loadScopes = useCallback(
		async (connection: string, family: DbCatalogFamily) => {
			setScopes((prev) => ({
				...prev,
				[connection]: { ...(prev[connection] ?? EMPTY_NODE), loading: true, error: null },
			}));
			try {
				const names = await listCatalogScopes(connection, family);
				const items: DbCatalogScope[] =
					family === "schemas"
						? names.map((name) => ({ kind: "schema", name }))
						: names.map((name) => ({ kind: "database", name }));
				setScopes((prev) => ({
					...prev,
					[connection]: { loaded: true, loading: false, error: null, items },
				}));
			} catch (caught) {
				const { message } = formatDatabaseError(t, caught);
				setScopes((prev) => ({
					...prev,
					[connection]: { ...(prev[connection] ?? EMPTY_NODE), loading: false, error: message },
				}));
			}
		},
		[t],
	);

	const loadColumns = useCallback(
		async (connection: string, table: string, scope?: DbCatalogScope) => {
			const key = tableKey(connection, table, scope);
			setColumns((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_NODE), loading: true, error: null } }));
			try {
				const items = await describeTable(
					connection,
					table,
					scope ? { [scope.kind === "schema" ? "schema" : "database"]: scope.name } : undefined,
				);
				setColumns((prev) => ({ ...prev, [key]: { loaded: true, loading: false, error: null, items } }));
			} catch (caught) {
				const { message } = formatDatabaseError(t, caught);
				setColumns((prev) => ({
					...prev,
					[key]: { ...(prev[key] ?? EMPTY_NODE), loading: false, error: message },
				}));
			}
		},
		[t],
	);

	const toggleConnection = useCallback((connection: string) => {
		setExpandedConnections((prev) => {
			const next = { ...prev };
			if (prev[connection] === true) {
				delete next[connection];
			} else {
				next[connection] = true;
			}
			return next;
		});
	}, []);

	const expandConnection = useCallback((connection: string) => {
		setExpandedConnections((prev) => ({ ...prev, [connection]: true }));
	}, []);

	const collapseConnection = useCallback((connection: string) => {
		setExpandedConnections((prev) => {
			const next = { ...prev };
			delete next[connection];
			return next;
		});
	}, []);

	const ensureScopes = useCallback(
		(connection: string, family: DbCatalogFamily) => {
			const node = scopes[connection];
			if (!(node?.loaded || node?.loading || node?.error)) void loadScopes(connection, family);
		},
		[loadScopes, scopes],
	);

	const reloadScopes = useCallback(
		(connection: string, family: DbCatalogFamily) => void loadScopes(connection, family),
		[loadScopes],
	);

	const toggleScope = useCallback(
		(connection: string, scope: DbCatalogScope) => {
			const key = listKey(connection, scope);
			const expanded = expandedScopes[key] === true;
			if (expanded) {
				setExpandedScopes((prev) => {
					const next = { ...prev };
					delete next[key];
					return next;
				});
				return;
			}
			const node = tables[key];
			if (!(node?.loaded || node?.loading)) void loadTables(connection, scope);
			setExpandedScopes((prev) => ({ ...prev, [key]: true }));
		},
		[expandedScopes, loadTables, tables],
	);

	const expandScope = useCallback(
		(connection: string, scope: DbCatalogScope) => {
			const key = listKey(connection, scope);
			const node = tables[key];
			if (!(node?.loaded || node?.loading)) void loadTables(connection, scope);
			setExpandedScopes((prev) => ({ ...prev, [key]: true }));
		},
		[loadTables, tables],
	);

	const expandConnections = useCallback((connections: readonly string[]) => {
		setExpandedConnections((prev) => {
			const next = { ...prev };
			for (const name of connections) next[name] = true;
			return next;
		});
	}, []);

	const collapseConnections = useCallback((connections: readonly string[]) => {
		setExpandedConnections((prev) => {
			const next = { ...prev };
			for (const name of connections) delete next[name];
			return next;
		});
	}, []);

	const toggleTable = useCallback(
		(connection: string, table: string, scope?: DbCatalogScope) => {
			const key = tableKey(connection, table, scope);
			const expanded = expandedTables[key] === true;
			if (expanded) {
				setExpandedTables((prev) => {
					const next = { ...prev };
					delete next[key];
					return next;
				});
				return;
			}
			const node = columns[key];
			if (!(node?.loaded || node?.loading)) void loadColumns(connection, table, scope);
			setExpandedTables((prev) => ({ ...prev, [key]: true }));
		},
		[columns, expandedTables, loadColumns],
	);

	const expandTable = useCallback(
		(connection: string, table: string, scope?: DbCatalogScope) => {
			const key = tableKey(connection, table, scope);
			const node = columns[key];
			if (!(node?.loaded || node?.loading)) void loadColumns(connection, table, scope);
			setExpandedTables((prev) => ({ ...prev, [key]: true }));
		},
		[columns, loadColumns],
	);

	const reloadTables = useCallback(
		(connection: string, scope?: DbCatalogScope) => void loadTables(connection, scope),
		[loadTables],
	);

	const ensureTables = useCallback(
		(connection: string, scope?: DbCatalogScope) => {
			const node = tables[listKey(connection, scope)];
			if (!(node?.loaded || node?.loading || node?.error)) void loadTables(connection, scope);
		},
		[loadTables, tables],
	);

	const reloadColumns = useCallback(
		(connection: string, table: string, scope?: DbCatalogScope) => void loadColumns(connection, table, scope),
		[loadColumns],
	);

	// V2-③ 分组折叠：折叠/展开互斥，不与其他展开状态联动。
	const toggleGroup = useCallback((group: string) => {
		setCollapsedGroups((prev) => {
			if (prev[group] === true) {
				const next = { ...prev };
				delete next[group];
				return next;
			}
			return { ...prev, [group]: true };
		});
	}, []);

	return {
		tablesOf: (connection, scope) => tables[listKey(connection, scope)] ?? EMPTY_NODE,
		columnsOf: (connection, table, scope) => columns[tableKey(connection, table, scope)] ?? EMPTY_NODE,
		scopesOf: (connection) => scopes[connection] ?? EMPTY_NODE,
		isConnectionExpanded: (connection) => expandedConnections[connection] === true,
		isTableExpanded: (connection, table, scope) => expandedTables[tableKey(connection, table, scope)] === true,
		isGroupCollapsed: (group) => collapsedGroups[group] === true,
		isScopeExpanded: (connection, scope) => expandedScopes[listKey(connection, scope)] === true,
		actions: {
			toggleConnection,
			expandConnection,
			collapseConnection,
			ensureScopes,
			reloadScopes,
			toggleScope,
			expandScope,
			toggleTable,
			expandTable,
			reloadTables,
			ensureTables,
			reloadColumns,
			toggleGroup,
			expandConnections,
			collapseConnections,
		},
	};
}
