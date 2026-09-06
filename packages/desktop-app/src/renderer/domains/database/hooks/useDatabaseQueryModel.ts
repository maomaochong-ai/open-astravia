import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DatabaseError, DbConnection, DbQueryResult, DbTableScope } from "../../../../preload/api-types/database";
import { executeQuery } from "../lib/database-api";
import { formatDatabaseError } from "../lib/database-error-labels";
import {
	clearQueryHistory,
	loadQueryHistory,
	pushQueryHistory,
	type QueryHistoryEntry,
	removeQueryHistory,
	saveQueryHistory,
} from "../lib/query-history";
import {
	createQueryTab,
	type DatabaseQueryStatus,
	type OpenTableMeta,
	patchQueryTab,
	type QueryTabState,
	reorderQueryTabs,
} from "../lib/query-tabs";
import { buildOpenTableSql } from "../lib/sql-dialect";

export const OPEN_TABLE_PAGE_SIZE = 100;

/** OpenTableMeta.scope → SQL 限定段（PG schema 或 MySQL database；null/空 → 不限定）。 */
function scopeQualifier(scope: DbTableScope | null | undefined): string | undefined {
	if (!scope) return undefined;
	return scope.schema ?? scope.database ?? undefined;
}

export type { DatabaseQueryStatus } from "../lib/query-tabs";

/** 可经 UI 危险确认后放行的拦截错误码（其余如 PROD_WRITE_BLOCKED 需连接级授权，只展示）。 */
const CONFIRMABLE_BLOCK_CODES = new Set(["DDL_BLOCKED", "WRITE_BLOCKED"]);

export type DatabaseQueryRunOutcome = "ok" | "confirm" | "blocked-prod";

export interface DatabaseQueryModel {
	/** #4 空态兼容：无任何打开查询时为 true（activeTabId=null，中栏显示引导而非常驻面板）。 */
	readonly empty: boolean;
	/** V5 多查询标签：每个标签独立 sql/status/result/error/openTableMeta/loadingMore + 标题。 */
	readonly tabs: readonly QueryTabState[];
	readonly activeTabId: string | null;
	/** 以下为激活标签的投影（兼容既有调用方，查询面板/结果网格直接消费）。 */
	/** V7:当前激活标签绑定的执行连接(tab 新建/打开表/AI 回填即锁定,对齐 dbx「tab 自带连接」;null = 未绑定 → 执行回退当前选中连接)。 */
	readonly activeTabConnectionName: string | null;
	readonly sql: string;
	readonly status: DatabaseQueryStatus;
	readonly result: DbQueryResult | null;
	readonly resultConnectionName: string | null;
	readonly resultSql: string | null;
	readonly error: string | null;
	readonly errorDetail: string | null;
	/** V3-③ 查询历史（最近 N 条，localStorage 持久化，成功执行才记录，全局共享）。 */
	readonly history: readonly QueryHistoryEntry[];
	/** V6-② 是否可「下一页」：结果来自「打开表」浏览且当前页已满（满页假设还有更多，对齐 dbx-main canGoNextDataGridPage）。 */
	readonly canGoNextPage: boolean;
	/** V6-② 服务端分页当前页（1-based；自由 SQL / AI 回填为 null）。 */
	readonly page: number | null;
	/** V6-② 服务端分页每页行数（打开表浏览恒 ≤ 100，受 dbx-mcp `dbx_execute_query` 上限约束）。 */
	readonly pageSize: number | null;
	/** V6-② 当前打开表浏览元信息（B3.2 数据编辑据此定位表/方言）。 */
	readonly openTableMeta: OpenTableMeta | null;
	/** V6-② 服务端翻页进行中（保持现有结果显示，分页按钮转 loading）。 */
	readonly loadingPage: boolean;
	readonly actions: {
		/** V7-⑤ 连接下拉：把激活标签的执行连接固定/切换到另一连接（对齐 dbx 顶栏连接切换）。清空既有结果/错误/元数据（保留 SQL 文本）；同连接 no-op。 */
		readonly rebindConnection: (connection: DbConnection) => void;
		/** V7-① 「+」新建空白标签(标题「查询 N」)并激活;传入 connectionName 则创建即绑定该连接(顶栏/双击连接场景),null = 未绑定(执行时回退当前选中)。传入 sql 则新建即预填(对齐 dbx「打开表上下文预填 SELECT」)。 */
		readonly addTab: (connectionName?: string | null, sql?: string | null) => void;
		/** V7-⑦ 复制标签：复制激活标签的标题/连接绑定/SQL/打开表元数据为新标签并激活（结果不复制，保持空白态）。 */
		readonly duplicateTab: (id: string) => void;
		/** V7-⑦ 关闭其他标签（保留 id 标签并激活）。 */
		readonly closeOtherTabs: (id: string) => void;
		/** V7-⑦ 关闭全部标签。 */
		readonly closeAllTabs: () => void;
		readonly closeTab: (id: string) => void;
		readonly activateTab: (id: string) => void;
		/** 拖拽排序：按新顺序重排标签。 */
		readonly reorderTabs: (ids: string[]) => void;
		/** 写入激活标签的 SQL 文本（用户输入 / V3-③ 历史重放回填）。 */
		readonly setSql: (sql: string) => void;
		/** B2.9-W1/B2.10-W3：AI 对话回填 —— 覆盖激活标签的 SQL + 结果/错误（不触发执行）。 */
		readonly applyResult: (
			connectionName: string,
			sqlText: string,
			result: DbQueryResult | null,
			error?: string | null,
			errorDetail?: string | null,
		) => void;
		/** 执行激活标签的 SQL（结果落在激活标签）。返回 "confirm"：写/DDL 被拦、需 UI 危险确认后调 runConfirmed。 */
		readonly run: (connection: DbConnection) => Promise<DatabaseQueryRunOutcome>;
		/** 执行激活标签的 SQL，且标记本次已通过 UI 危险确认（DDL / 写语句放行依据）。 */
		readonly runConfirmed: (connection: DbConnection) => Promise<DatabaseQueryRunOutcome>;
		/** P1：SQL 块「执行」—— 新建 tab 预填 SQL 并立即执行（结果落新 tab）。危险 SQL 返回 "confirm"（复用工作台 danger-confirm UI 后以 confirmedWrite=true 重试）。 */
		readonly runSqlInNewTab: (
			connection: DbConnection,
			sqlText: string,
			confirmedWrite?: boolean,
		) => Promise<DatabaseQueryRunOutcome>;
		/** V6-③ 单击打开表（对齐 dbx）：同连接+同表+同 scope 已开则聚焦复用；forceNewTab=true 强制新开。生成方言 SQL 并执行。 */
		readonly openTable: (
			connection: DbConnection,
			table: string,
			scope?: DbTableScope | null,
			forceNewTab?: boolean,
		) => Promise<void>;
		/** V6-② 服务端分页翻页：对「打开表」结果按 `LIMIT pageSize OFFSET (page-1)*pageSize` 重查（自由 SQL 无此能力）。
		 * 可选 pageSize：切换每页行数时传入，会一并更新 openTableMeta.pageSize 并回到目标页。 */
		readonly goToPage: (connection: DbConnection, page: number, pageSize?: number) => Promise<void>;
		/** B3.2 数据编辑后刷新：用当前打开表元信息（type/table/limit）重取结果，不动标签与历史。 */
		readonly reloadOpenTable: (connection: DbConnection) => Promise<void>;
		/** B3.2-R 自由 SQL 结果写后刷新：重跑指定 SQL（不推历史）。 */
		readonly rerun: (connection: DbConnection, sqlText: string) => Promise<void>;
		/** V3-③ 清空查询历史（localStorage 一并清除）。 */
		readonly clearHistory: () => void;
		/** V3-④ 删除单条历史（对齐 dbx 历史面板逐条删除；localStorage 一并更新）。 */
		readonly removeHistoryEntry: (id: string) => void;
	};
}

/** 查询面板状态（B2.6 + V3 + V5 多查询标签）：SQL 文本、执行状态、结果 / 错误、查询历史；「打开表」生成方言 SQL 并直接执行。 */
export function useDatabaseQueryModel(): DatabaseQueryModel {
	const { t } = useTranslation("settings");

	// #4 对齐 dbx：初始无标签（空态）。未双击表 / 未新建查询前中栏显示引导空态，
	// 不常驻空白查询面板与空结果网格；首个动作（+ 新建 / 双击表 / AI 回填）才创建标签。
	const [tabs, setTabs] = useState<QueryTabState[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);
	const nextTabIdRef = useRef(2);
	const nextTabNumberRef = useRef(2);
	const [history, setHistory] = useState<readonly QueryHistoryEntry[]>(() => loadQueryHistory());

	const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
	// 空态下首次新建从「查询 1」重新起计，避免关闭全部标签后编号跳变。
	const claimNextTabId = useCallback((fresh: boolean) => {
		if (fresh) {
			nextTabIdRef.current = 2;
			return "query-1";
		}
		return `query-${nextTabIdRef.current++}`;
	}, []);
	const claimNextTabNumber = useCallback((fresh: boolean) => {
		if (fresh) {
			nextTabNumberRef.current = 2;
			return 1;
		}
		return nextTabNumberRef.current++;
	}, []);

	const recordHistory = useCallback((connectionName: string, sqlText: string) => {
		setHistory((prev) => {
			const next = pushQueryHistory(prev, connectionName, sqlText);
			if (next !== prev) saveQueryHistory(next);
			return next;
		});
	}, []);

	const runSql = useCallback(
		async (
			connection: DbConnection,
			sqlText: string,
			tabId: string,
			record = true,
			confirmedWrite = false,
		): Promise<DatabaseQueryRunOutcome> => {
			setTabs((prev) => patchQueryTab(prev, tabId, { status: "running", error: null, errorDetail: null }));
			try {
				const data = await executeQuery(
					connection.name,
					sqlText,
					confirmedWrite ? { confirmedWrite: true, confirmedSql: sqlText } : undefined,
				);
				setTabs((prev) =>
					patchQueryTab(prev, tabId, {
						result: data,
						resultConnectionName: connection.name,
						connectionName: connection.name,
						resultSql: sqlText,
						status: "success",
					}),
				);
				if (record) recordHistory(connection.name, sqlText);
				return "ok";
			} catch (caught) {
				const { message, detail } = formatDatabaseError(t, caught);
				setTabs((prev) =>
					patchQueryTab(prev, tabId, {
						result: null,
						resultConnectionName: connection.name,
						connectionName: connection.name,
						resultSql: sqlText,
						error: message,
						errorDetail: detail,
						status: "error",
					}),
				);
				const code = (caught as DatabaseError | null)?.code;
				if (code === "PROD_WRITE_BLOCKED") return "blocked-prod";
				return code && CONFIRMABLE_BLOCK_CODES.has(code) ? "confirm" : "ok";
			}
		},
		[t, recordHistory],
	);
	const runInternal = useCallback(
		async (connection: DbConnection, confirmedWrite: boolean): Promise<DatabaseQueryRunOutcome> => {
			if (!activeTab) return "ok"; // 空态下无标签可执行
			const text = activeTab.sql.trim();
			if (!text) return "ok";
			setTabs((prev) => patchQueryTab(prev, activeTab.id, { openTableMeta: null })); // 用户自由 SQL 结果不提供加载更多
			return runSql(connection, text, activeTab.id, true, confirmedWrite);
		},
		[activeTab, runSql],
	);

	const addTab = useCallback(
		(connectionName: string | null = null, sql: string | null = null) => {
			const fresh = tabs.length === 0;
			const id = claimNextTabId(fresh);
			const title = t("databaseQueryTab", { count: claimNextTabNumber(fresh) });
			setTabs((prev) => [
				...prev,
				createQueryTab(id, title, {
					connectionName: connectionName ?? null,
					sql: sql ?? "",
				}),
			]);
			setActiveTabId(id);
		},
		[t, tabs.length, claimNextTabId, claimNextTabNumber],
	);

	const closeTab = useCallback(
		(id: string) => {
			const index = tabs.findIndex((tab) => tab.id === id);
			if (index === -1) return;
			const next = tabs.filter((tab) => tab.id !== id);
			setTabs(next);
			if (activeTabId === id) {
				// #4：关闭最后一个标签回到空态（对齐 dbx —— 无打开查询时中栏显示空态，不常驻空白查询）。
				if (next.length === 0) setActiveTabId(null);
				else setActiveTabId((next[Math.min(index, next.length - 1)] ?? next[0]).id);
			}
		},
		[tabs, activeTabId],
	);

	const duplicateTab = useCallback(
		(id: string) => {
			const source = tabs.find((tab) => tab.id === id);
			if (!source) return;
			const index = tabs.findIndex((tab) => tab.id === id);
			const copy = createQueryTab(claimNextTabId(false), source.title, {
				connectionName: source.connectionName ?? undefined,
				sql: source.sql || undefined,
				openTableMeta: source.openTableMeta ? { ...source.openTableMeta } : undefined,
			});
			const next = [...tabs];
			next.splice(index + 1, 0, copy);
			setTabs(next);
			setActiveTabId(copy.id);
		},
		[tabs, claimNextTabId],
	);

	const closeOtherTabs = useCallback((id: string) => {
		setTabs((prev) => prev.filter((tab) => tab.id === id));
		setActiveTabId(id);
	}, []);

	const closeAllTabs = useCallback(() => {
		setTabs([]);
		setActiveTabId(null);
	}, []);

	const activateTab = useCallback((id: string) => {
		setActiveTabId(id);
	}, []);

	const rebindConnection = useCallback(
		(connection: DbConnection) => {
			if (!activeTab) return; // 空态无标签可切换
			if (activeTab.connectionName === connection.name) return; // 同一连接：no-op，不打扰既有结果
			setTabs((prev) =>
				patchQueryTab(prev, activeTab.id, {
					connectionName: connection.name,
					status: "idle",
					result: null,
					resultConnectionName: null,
					resultSql: null,
					error: null,
					errorDetail: null,
					openTableMeta: null,
					loadingPage: false,
				}),
			);
		},
		[activeTab],
	);

	const reorderTabs = useCallback((ids: string[]) => {
		setTabs((prev) => reorderQueryTabs(prev, ids));
	}, []);

	const setSql = useCallback(
		(sql: string) => {
			if (!activeTabId) return;
			setTabs((prev) => patchQueryTab(prev, activeTabId, { sql }));
		},
		[activeTabId],
	);

	const run = useCallback(
		async (connection: DbConnection): Promise<DatabaseQueryRunOutcome> => runInternal(connection, false),
		[runInternal],
	);
	const runConfirmed = useCallback(
		async (connection: DbConnection): Promise<DatabaseQueryRunOutcome> => runInternal(connection, true),
		[runInternal],
	);

	const rerun = useCallback(
		async (connection: DbConnection, sqlText: string) => {
			if (!activeTab) return; // 空态无标签可刷新
			await runSql(connection, sqlText, activeTab.id, false);
		},
		[activeTab, runSql],
	);

	/** P1：SQL 块「执行」—— 新建 tab 预填 SQL 并激活，立即执行（结果落新 tab，记历史）。危险 SQL 被拦时返回 "confirm"。 */
	const runSqlInNewTab = useCallback(
		async (connection: DbConnection, sqlText: string, confirmedWrite = false): Promise<DatabaseQueryRunOutcome> => {
			const fresh = tabs.length === 0;
			const id = claimNextTabId(fresh);
			const title = t("databaseQueryTab", { count: claimNextTabNumber(fresh) });
			setTabs((prev) => [
				...prev,
				createQueryTab(id, title, {
					connectionName: connection.name,
					sql: sqlText,
				}),
			]);
			setActiveTabId(id);
			return runSql(connection, sqlText, id, true, confirmedWrite);
		},
		[tabs.length, claimNextTabId, claimNextTabNumber, runSql, t],
	);

	const applyResult = useCallback(
		(
			connectionName: string,
			sqlText: string,
			result: DbQueryResult | null,
			error: string | null = null,
			errorDetail: string | null = null,
		) => {
			const patch: Partial<Omit<QueryTabState, "id" | "title">> = {
				sql: sqlText,
				status: result ? "success" : error ? "error" : "idle",
				result,
				resultConnectionName: connectionName,
				connectionName: connectionName,
				resultSql: sqlText,
				error,
				errorDetail,
				openTableMeta: null, // AI 回填结果不提供加载更多
			};
			if (tabs.length === 0) {
				// 空态下 AI 回填（B2.9-W1/B2.10-W3）：先创建承载标签再回填。
				const id = claimNextTabId(true);
				const title = t("databaseQueryTab", { count: claimNextTabNumber(true) });
				setTabs([createQueryTab(id, title, patch)]);
				setActiveTabId(id);
			} else if (activeTabId) {
				setTabs((prev) => patchQueryTab(prev, activeTabId, patch));
			}
		},
		[activeTabId, tabs.length, t, claimNextTabId, claimNextTabNumber],
	);

	const openTable = useCallback(
		async (connection: DbConnection, table: string, scope?: DbTableScope | null, forceNewTab = false) => {
			// V6-③ 对齐 dbx「单击即开」：同连接 + 同表 + 同 scope 已开则聚焦复用（防双击/重复点击堆叠 tab）；
			// Cmd/Ctrl+单击 = 强制新开 tab。scope：catalog 分层连接（PG schema / MySQL database）→ 生成带限定前缀的方言 SQL。
			if (!forceNewTab) {
				const existing = tabs.find(
					(tab) =>
						tab.openTableMeta != null &&
						tab.openTableMeta.table === table &&
						tab.openTableMeta.connectionName === connection.name &&
						scopeQualifier(tab.openTableMeta.scope) === scopeQualifier(scope),
				);
				if (existing) {
					setActiveTabId(existing.id);
					return;
				}
			}
			const fresh = tabs.length === 0;
			const id = claimNextTabId(fresh);
			const sqlText = buildOpenTableSql(connection.type, table, undefined, undefined, scopeQualifier(scope));
			setTabs((prev) => [
				...prev,
				createQueryTab(id, table, {
					connectionName: connection.name,
					sql: sqlText,
					openTableMeta: {
						connectionName: connection.name,
						type: connection.type,
						table,
						pageSize: OPEN_TABLE_PAGE_SIZE,
						page: 1,
						scope: scope ?? null,
					},
				}),
			]);
			setActiveTabId(id);
			await runSql(connection, sqlText, id);
		},
		[runSql, tabs, claimNextTabId],
	);

	// V6-② 服务端分页翻页：保持现有结果显示，按目标页 OFFSET 重查并替换结果（作用于激活标签）。
	// 背景：dbx-mcp `dbx_execute_query` 最多返回 100 行（工具写死 limit=100），
	// 旧的「加载更多」加大 LIMIT 重取永远拿不到第 101 行之后 —— 改为每页固定 pageSize（≤100）行，
	// 翻页用 `LIMIT pageSize OFFSET (page-1)*pageSize`，MCP 截断前 100 行恰好是目标页内容（对齐 dbx-main 服务端分页）。
	const goToPage = useCallback(
		async (connection: DbConnection, page: number, pageSize?: number) => {
			const tab = activeTab;
			if (!tab?.openTableMeta || tab.loadingPage) return;
			const meta = tab.openTableMeta;
			const target = Math.max(1, page);
			// 切换每页行数：仅取 MCP 截断上限内的档位（≤100），避免“页大小大于实返行数”造成的行号/范围错位。
			const size = pageSize != null ? Math.max(1, Math.min(100, Math.trunc(pageSize))) : meta.pageSize;
			const sqlText = buildOpenTableSql(
				meta.type,
				meta.table,
				size,
				(target - 1) * size,
				scopeQualifier(meta.scope),
			);
			const tabId = tab.id;
			setTabs((prev) =>
				patchQueryTab(prev, tabId, {
					sql: sqlText,
					loadingPage: true,
				}),
			);
			try {
				const data = await executeQuery(connection.name, sqlText);
				setTabs((prev) =>
					patchQueryTab(prev, tabId, {
						result: data,
						resultConnectionName: connection.name,
						resultSql: sqlText,
						status: "success",
						error: null,
						errorDetail: null,
						openTableMeta: { ...meta, page: target, pageSize: size },
					}),
				);
				recordHistory(connection.name, sqlText);
			} catch (caught) {
				const { message, detail } = formatDatabaseError(t, caught);
				setTabs((prev) => patchQueryTab(prev, tabId, { error: message, errorDetail: detail, status: "error" }));
			} finally {
				setTabs((prev) => patchQueryTab(prev, tabId, { loadingPage: false }));
			}
		},
		[activeTab, recordHistory, t],
	);

	// B3.2 数据编辑后刷新：写操作成功后按当前 openTableMeta 重取（保持 page/pageSize 与标签不变，不记历史）。
	const reloadOpenTable = useCallback(
		async (connection: DbConnection) => {
			const tab = activeTab;
			if (!tab?.openTableMeta) return;
			const meta = tab.openTableMeta;
			await runSql(
				connection,
				buildOpenTableSql(
					meta.type,
					meta.table,
					meta.pageSize,
					(meta.page - 1) * meta.pageSize,
					scopeQualifier(meta.scope),
				),
				tab.id,
			);
		},
		[activeTab, runSql],
	);

	const clearHistory = useCallback(() => {
		setHistory([]);
		clearQueryHistory();
	}, []);

	const removeHistoryEntry = useCallback((id: string) => {
		setHistory((prev) => {
			const next = removeQueryHistory(prev, id);
			if (next !== prev) saveQueryHistory(next);
			return next;
		});
	}, []);

	return {
		tabs,
		activeTabId,
		empty: tabs.length === 0,
		sql: activeTab?.sql ?? "",
		status: activeTab?.status ?? "idle",
		result: activeTab?.result ?? null,
		resultConnectionName: activeTab?.resultConnectionName ?? null,
		resultSql: activeTab?.resultSql ?? null,
		error: activeTab?.error ?? null,
		errorDetail: activeTab?.errorDetail ?? null,
		history,
		canGoNextPage:
			activeTab !== null &&
			activeTab.openTableMeta !== null &&
			activeTab.status === "success" &&
			(activeTab.result?.rows.length ?? 0) >= activeTab.openTableMeta.pageSize,
		page: activeTab?.openTableMeta?.page ?? null,
		pageSize: activeTab?.openTableMeta?.pageSize ?? null,
		openTableMeta: activeTab?.openTableMeta ?? null,
		activeTabConnectionName: activeTab?.connectionName ?? null,
		loadingPage: activeTab?.loadingPage ?? false,
		actions: {
			addTab,
			closeTab,
			duplicateTab,
			closeOtherTabs,
			closeAllTabs,
			activateTab,
			reorderTabs,
			setSql,
			run,
			runConfirmed,
			openTable,
			goToPage,
			reloadOpenTable,
			rerun,
			runSqlInNewTab,
			rebindConnection,
			applyResult,
			clearHistory,
			removeHistoryEntry,
		},
	};
}
