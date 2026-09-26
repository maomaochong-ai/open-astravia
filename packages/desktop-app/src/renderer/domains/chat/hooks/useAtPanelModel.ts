import { catalogFamilyOfType, scopeToTableScope } from "@domains/database/lib/catalog-family";
import type { DbCatalogScope, DbConnection, DbTableInfo } from "@preload/api-types/database";
import type { FsEntry, FsFileRef } from "@preload/fs-types";
import { type ShortcutBinding, useShortcutScope } from "@shared/shortcuts";
import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	AtPanelEntryModel,
	AtPanelLabels,
	AtPanelProps,
	AtPanelSelection,
	AtPanelViewProps,
} from "../components/at-panel/types";

// AtPanelModel 内部定义，不导出
interface AtPanelModel {
	hidden: boolean;
	viewProps: AtPanelViewProps;
}

// ─── 文件面板工具函数（原 useAtPanelModel 逻辑） ───

function fuzzyScore(query: string, path: string, name: string): number | null {
	const t = path.toLowerCase();
	let qi = 0;
	let score = 0;
	let prev = -2;
	for (let ti = 0; ti < t.length && qi < query.length; ti++) {
		if (t[ti] === query[qi]) {
			score += prev === ti - 1 ? 6 : 1;
			const before = ti === 0 ? "/" : t[ti - 1];
			if (before === "/" || before === "-" || before === "_" || before === ".") score += 4;
			prev = ti;
			qi++;
		}
	}
	if (qi < query.length) return null;
	if (name.toLowerCase().includes(query)) score += 15;
	score -= t.length * 0.02;
	return score;
}

const MAX_SEARCH_RESULTS = 100;
const HIDDEN = new Set(["node_modules", ".git", ".DS_Store", "Thumbs.db"]);

function fileIcon(name: string, isDir: boolean): string {
	if (isDir) return "icon-[solar--folder-linear]";
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	switch (ext) {
		case "ts":
		case "tsx":
			return "icon-[mdi--language-typescript]";
		case "js":
		case "jsx":
			return "icon-[mdi--language-javascript]";
		case "json":
			return "icon-[mdi--code-json]";
		case "md":
		case "mdx":
			return "icon-[mdi--language-markdown]";
		case "css":
		case "scss":
			return "icon-[mdi--language-css3]";
		case "html":
			return "icon-[mdi--language-html5]";
		case "py":
			return "icon-[mdi--language-python]";
		case "rs":
			return "icon-[mdi--language-rust]";
		case "go":
			return "icon-[mdi--language-go]";
		case "yaml":
		case "yml":
			return "icon-[mdi--file-cog-outline]";
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "svg":
		case "webp":
			return "icon-[mdi--file-image-outline]";
		case "pdf":
			return "icon-[mdi--file-pdf-box]";
		case "docx":
		case "doc":
			return "icon-[mdi--file-word-outline]";
		default:
			return "icon-[solar--file-linear]";
	}
}

function parentOf(path: string): string {
	return path.replace(/\/[^/]+\/?$/, "") || "/";
}

// ─── 数据库面板工具函数 ───

const DB_CONNECTION_PATH_PREFIX = "conn:";
const DB_CATALOG_PATH_PREFIX = "catalog:";
const DB_TABLE_PATH_PREFIX = "table:";

function connectionPath(connName: string): string {
	return `${DB_CONNECTION_PATH_PREFIX}${connName}`;
}

function catalogPath(connName: string, kind: "schema" | "database", name: string): string {
	return `${DB_CATALOG_PATH_PREFIX}${connName}:${kind}:${name}`;
}

function tablePath(connName: string, tableName: string, scope?: DbCatalogScope | null): string {
	if (scope) {
		return `${DB_TABLE_PATH_PREFIX}${connName}.${scope.kind}.${scope.name}.${tableName}`;
	}
	return `${DB_TABLE_PATH_PREFIX}${connName}.${tableName}`;
}

function parseConnectionPath(path: string): string | null {
	return path.startsWith(DB_CONNECTION_PATH_PREFIX) ? path.slice(DB_CONNECTION_PATH_PREFIX.length) : null;
}

function parseCatalogPath(path: string): { connection: string; scope: DbCatalogScope } | null {
	if (!path.startsWith(DB_CATALOG_PATH_PREFIX)) return null;
	const rest = path.slice(DB_CATALOG_PATH_PREFIX.length);
	const parts = rest.split(":");
	if (parts.length !== 3) return null;
	const [connName, kind, name] = parts;
	if (kind !== "schema" && kind !== "database") return null;
	return { connection: connName, scope: { kind, name } };
}

function parseTablePath(path: string): { connection: string; table: string; scope?: DbCatalogScope } | null {
	if (!path.startsWith(DB_TABLE_PATH_PREFIX)) return null;
	const rest = path.slice(DB_TABLE_PATH_PREFIX.length);
	// 尝试 4 段格式：conn.kind.scopeName.table
	const parts = rest.split(".");
	if (parts.length === 4 && (parts[1] === "schema" || parts[1] === "database")) {
		return {
			connection: parts[0],
			table: parts[3],
			scope: { kind: parts[1] as "schema" | "database", name: parts[2] },
		};
	}
	// 2 段格式：conn.table（向后兼容 + flat 类型）
	if (parts.length === 2) {
		return { connection: parts[0], table: parts[1] };
	}
	return null;
}

// ─── 主 hook ───

/** 数据库面板的加载层级：null=显示连接列表，string=显示该连接的 catalog/表 */
type DbLevel = null | string;

interface AtPanelInternalState {
	mode: "files" | "database";
	// ─── Files mode ───
	currentDir: string;
	entries: FsEntry[];
	allFiles: FsFileRef[];
	// ─── Database mode ───
	dbConnections: DbConnection[];
	dbLevel: DbLevel; // null = 连接列表, string = 某连接的 catalog/表
	dbLevelEntries: DbTableInfo[]; // 当前表列表（可能带 scope）
	dbCatalog: DbCatalogScope | null; // 当前 catalog 作用域（PG=schema, MySQL=database, flat=null）
	dbCatalogEntries: string[]; // catalog 名列表（供 family !== "flat" 使用）
}

export function useAtPanelModel({
	open,
	onClose,
	onSelect,
	filter,
	cwd,
	className,
	classNames,
}: AtPanelProps): AtPanelModel {
	const { t } = useTranslation("chat");
	const [activeIndex, setActiveIndex] = useState(0);
	const panelRef = useRef<HTMLDivElement>(null);
	const shouldScrollActiveIntoViewRef = useRef(false);

	const [state, setState] = useState<AtPanelInternalState>({
		mode: "files",
		currentDir: cwd,
		entries: [],
		allFiles: [],
		dbConnections: [],
		dbLevel: null,
		dbLevelEntries: [],
		dbCatalog: null,
		dbCatalogEntries: [],
	});
	const [loading, setLoading] = useState(false);

	// ─── 打开面板时 reset ───
	useEffect(() => {
		if (!open) return;
		setState((prev) => ({
			...prev,
			mode: "files",
			currentDir: cwd,
			dbLevel: null,
			dbCatalog: null,
			dbCatalogEntries: [],
		}));
		setActiveIndex(0);
	}, [open, cwd]);

	// ─── Files mode：目录内容加载 ───
	useEffect(() => {
		if (!open || state.mode !== "files") return;
		let cancelled = false;
		setLoading(true);
		void window.astravia.fs.readDir(state.currentDir).then((result) => {
			if (cancelled) return;
			const visible = result.filter((e) => !HIDDEN.has(e.name) && !e.name.startsWith("."));
			visible.sort((a, b) => {
				if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
				return a.name.localeCompare(b.name);
			});
			setState((prev) => ({ ...prev, entries: visible }));
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [open, state.mode, state.currentDir]);

	// ─── Files mode：全量文件索引（用于搜索） ───
	useEffect(() => {
		if (!open || state.mode !== "files") return;
		let cancelled = false;
		void window.astravia.fs.listFilesRecursive(cwd).then((files) => {
			if (!cancelled) setState((prev) => ({ ...prev, allFiles: files }));
		});
		return () => {
			cancelled = true;
		};
	}, [open, state.mode, cwd]);

	// ─── 连接列表预加载（打开面板时无条件加载，不管当前 tab） ───
	// showTabs 判断需要 dbConnections 长度——如果只在 database mode 加载，
	// files mode 下 tab 就不会出现，形成死锁（无法切到 database mode）。
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		void window.astravia.database.listConnections().then((result) => {
			if (cancelled) return;
			const conns = result.ok ? result.data : [];
			setState((prev) => ({ ...prev, dbConnections: conns }));
		});
		return () => {
			cancelled = true;
		};
	}, [open]);

	// ─── Database mode：连接下的 catalog 列表加载（非 flat 类型才需要） ───
	useEffect(() => {
		if (!open || state.mode !== "database" || state.dbLevel === null) return;
		const conn = state.dbConnections.find((c) => c.name === state.dbLevel);
		const family = conn ? catalogFamilyOfType(conn.type) : "flat";
		if (family === "flat") {
			// flat 类型不需要 catalog 层，跳过——由下面的表列表 effect 直接加载
			setState((prev) => ({ ...prev, dbCatalogEntries: [] }));
			return;
		}
		// 已经选中了 catalog，不需要重新加载 catalog 列表
		if (state.dbCatalog !== null) return;

		let cancelled = false;
		setLoading(true);
		void window.astravia.database.listCatalogScopes(state.dbLevel, family).then((result) => {
			if (cancelled) return;
			setState((prev) => ({
				...prev,
				dbCatalogEntries: result.ok ? result.data : [],
			}));
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [open, state.mode, state.dbLevel, state.dbCatalog, state.dbConnections]);

	// ─── Database mode：表列表加载（flat 直接进，非 flat 需选 catalog） ───
	useEffect(() => {
		if (!open || state.mode !== "database" || state.dbLevel === null) return;
		const conn = state.dbConnections.find((c) => c.name === state.dbLevel);
		if (!conn) return;
		const family = catalogFamilyOfType(conn.type);
		if (family !== "flat" && state.dbCatalog === null) return; // 先过 catalog 层

		let cancelled = false;
		setLoading(true);
		const scope = state.dbCatalog ? scopeToTableScope(state.dbCatalog) : undefined;
		void window.astravia.database.listTables(state.dbLevel, scope).then((result) => {
			if (cancelled) return;
			setState((prev) => ({
				...prev,
				dbLevelEntries: result.ok ? result.data : [],
			}));
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [open, state.mode, state.dbLevel, state.dbCatalog, state.dbConnections]);

	// ─── 搜索 & filter ───
	const normalizedFilter = filter.startsWith("@") ? filter.slice(1) : filter;
	const isSearching = normalizedFilter.length > 0;

	// ─── Files mode entries ───
	const filesEntries = useMemo((): { item: DisplayItem }[] => {
		if (!isSearching) {
			return state.entries.map((e) => ({
				item: { path: e.path, name: e.name, isDirectory: e.isDirectory },
			}));
		}
		const q = normalizedFilter.toLowerCase();
		const scored: { item: DisplayItem; score: number }[] = [];
		for (const f of state.allFiles) {
			const score = fuzzyScore(q, f.relPath, f.name);
			if (score !== null) {
				scored.push({
					item: { path: f.path, name: f.name, isDirectory: false, relPath: f.relPath },
					score,
				});
			}
		}
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, MAX_SEARCH_RESULTS).map((s) => ({ item: s.item }));
	}, [state.entries, state.allFiles, isSearching, normalizedFilter]);

	// ─── Database mode entries ───
	const dbEntries = useMemo((): AtPanelEntryModel[] => {
		const filterLower = normalizedFilter.toLowerCase();

		if (state.dbLevel === null) {
			// 连接列表
			const connections = state.dbConnections;
			const filtered = isSearching
				? connections.filter((c) => {
						const combined = `${c.name} ${c.database} ${c.host}`.toLowerCase();
						return combined.includes(filterLower);
					})
				: connections;
			return filtered.map((c, i) => ({
				path: connectionPath(c.name),
				name: c.name,
				isDirectory: true,
				relPath: `${c.type} · ${c.database}`,
				index: i,
				active: false, // active 在下面统一设置
				icon: "icon-[solar--database-linear]",
				kind: "connection" as const,
				env: c.env,
			}));
		}

		// dbLevel 非空——判断是 flat 直接表列表，还是非 flat 先 catalog 后表
		const conn = state.dbConnections.find((c) => c.name === state.dbLevel);
		const connName = state.dbLevel; // null-check 已过
		const family = conn ? catalogFamilyOfType(conn.type) : "flat";

		if (family !== "flat" && state.dbCatalog === null) {
			// catalog 列表（PG schema / MySQL database）
			const filtered = isSearching
				? state.dbCatalogEntries.filter((n) => n.toLowerCase().includes(filterLower))
				: state.dbCatalogEntries;
			const kind: "schema" | "database" = family === "schemas" ? "schema" : "database";
			const kindLabel = family === "schemas" ? "schema" : "database";
			// 图标按 kind 区分：schema 用 folder-open，database 用 database（与 DatabaseExplorerTree 语义对齐，同属 Solar Linear 族）
			const catalogIcon = kind === "schema" ? "icon-[solar--folder-open-linear]" : "icon-[solar--database-linear]";
			return filtered.map((name, i) => ({
				path: catalogPath(connName, kind, name),
				name,
				isDirectory: true,
				relPath: `${connName} · ${kindLabel}`,
				index: i,
				active: false,
				icon: catalogIcon,
				kind: "catalog" as const,
				env: conn?.env,
			}));
		}

		// 表列表（flat 直接进；非 flat 已选 catalog）
		const tables = state.dbLevelEntries;
		const filtered = isSearching ? tables.filter((t) => t.name.toLowerCase().includes(filterLower)) : tables;
		const scope = state.dbCatalog;
		const relPath = scope ? `${connName} · ${scope.name}` : connName;
		return filtered.map((t, i) => ({
			path: tablePath(connName, t.name, scope),
			name: t.name,
			isDirectory: false,
			relPath,
			index: i,
			active: false,
			icon: "icon-[solar--document-text-linear]",
			kind: "table" as const,
			connection: connName,
			scope: scope ?? undefined,
			env: conn?.env,
		}));
	}, [
		state.dbConnections,
		state.dbLevel,
		state.dbCatalog,
		state.dbLevelEntries,
		state.dbCatalogEntries,
		isSearching,
		normalizedFilter,
	]);

	// ─── 统一 entries（传给 View 的 AtPanelEntryModel 列表） ───
	const canGoUp =
		state.mode === "files"
			? !isSearching && state.currentDir !== cwd
			: state.mode === "database" && state.dbLevel !== null;

	const allEntries: AtPanelEntryModel[] = useMemo(() => {
		if (state.mode === "files") {
			return filesEntries.map(({ item }, i) => ({
				path: item.path,
				name: item.name,
				isDirectory: item.isDirectory,
				relPath: item.relPath,
				index: canGoUp ? i + 1 : i,
				active: (canGoUp ? i + 1 : i) === activeIndex,
				icon: fileIcon(item.name, item.isDirectory),
				kind: item.isDirectory ? "directory" : "file",
			}));
		}
		// database mode
		return dbEntries.map((e) => ({
			...e,
			index: canGoUp ? e.index + 1 : e.index,
			active: (canGoUp ? e.index + 1 : e.index) === activeIndex,
		}));
	}, [state.mode, filesEntries, dbEntries, canGoUp, activeIndex]);

	const isSearchWithNoResults = open && isSearching && (loading || allEntries.length === 0);

	useEffect(() => {
		if (isSearchWithNoResults) onClose();
	}, [isSearchWithNoResults, onClose]);

	// Reset highlight when filter/dir/dbLevel/mode changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on multiple trigger changes
	useEffect(() => {
		setActiveIndex(0);
	}, [filter, state.currentDir, state.dbLevel, state.mode]);

	const totalCount = (canGoUp ? 1 : 0) + allEntries.length;

	// ─── 条目点击 ───
	const handleEntryClick = useCallback(
		(entry: AtPanelEntryModel) => {
			if (state.mode === "files") {
				if (entry.isDirectory) {
					setState((prev) => ({ ...prev, currentDir: entry.path }));
					return;
				}
				onSelect({
					path: entry.path,
					name: entry.name,
					isDirectory: false,
				} satisfies AtPanelSelection);
				return;
			}

			// database mode
			const connName = parseConnectionPath(entry.path);
			if (connName) {
				// 点击了连接 → 进入 catalog 列表（或 flat 直接表列表）
				setState((prev) => ({
					...prev,
					dbLevel: connName,
					dbCatalog: null,
					dbCatalogEntries: [],
					dbLevelEntries: [],
				}));
				return;
			}
			const catalogRef = parseCatalogPath(entry.path);
			if (catalogRef) {
				// 点击了 catalog → 进入表列表（带 scope）
				setState((prev) => ({
					...prev,
					dbLevel: catalogRef.connection,
					dbCatalog: catalogRef.scope,
					dbLevelEntries: [],
				}));
				return;
			}
			const tableRef = parseTablePath(entry.path);
			if (tableRef) {
				const conn = state.dbConnections.find((c) => c.name === tableRef.connection);
				onSelect({
					kind: "database-table",
					connection: tableRef.connection,
					table: tableRef.table,
					scope: tableRef.scope,
					env: conn?.env,
				} satisfies AtPanelSelection);
			}
		},
		[state.mode, state.dbConnections, onSelect],
	);

	// ─── 返回上一层 ───
	const handleGoUp = useCallback(() => {
		if (state.mode === "files") {
			setState((prev) => ({ ...prev, currentDir: parentOf(prev.currentDir) }));
		} else if (state.dbCatalog !== null) {
			// 表列表 → catalog 列表
			setState((prev) => ({ ...prev, dbCatalog: null, dbLevelEntries: [] }));
		} else {
			// catalog 列表 → 连接列表（flat 类型直接从表列表 → 连接列表）
			setState((prev) => ({ ...prev, dbLevel: null, dbLevelEntries: [], dbCatalogEntries: [] }));
		}
	}, [state.mode, state.dbCatalog]);

	// ─── Tab 切换 ───
	const handleModeChange = useCallback(
		(mode: "files" | "database") => {
			setState((prev) => ({
				...prev,
				mode,
				currentDir: cwd,
				dbLevel: null,
				dbCatalog: null,
				dbLevelEntries: [],
				dbCatalogEntries: [],
			}));
			setActiveIndex(0);
		},
		[cwd],
	);

	// ─── 键盘导航 ───
	const keyBindings = useMemo((): ShortcutBinding[] => {
		return [
			{
				key: "arrowdown",
				run: () => {
					if (totalCount === 0) return;
					shouldScrollActiveIntoViewRef.current = true;
					setActiveIndex((i) => (i + 1) % totalCount);
				},
			},
			{
				key: "arrowup",
				run: () => {
					if (totalCount === 0) return;
					shouldScrollActiveIntoViewRef.current = true;
					setActiveIndex((i) => (i - 1 + totalCount) % totalCount);
				},
			},
			{
				key: "enter",
				run: () => {
					if (totalCount === 0) return;
					if (canGoUp && activeIndex === 0) {
						handleGoUp();
					} else {
						const entry = allEntries[canGoUp ? activeIndex - 1 : activeIndex];
						if (entry) handleEntryClick(entry);
					}
				},
			},
			{
				key: "escape",
				run: () => onClose(),
			},
			{
				key: "tab",
				run: () => {
					if (state.mode === "files") {
						const entry = allEntries[canGoUp ? activeIndex - 1 : activeIndex];
						if (entry?.isDirectory) setState((prev) => ({ ...prev, currentDir: entry.path }));
					} else {
						// Tab 在 database mode 下：选中连接 → 进入表列表
						const entry = allEntries[canGoUp ? activeIndex - 1 : activeIndex];
						const connName = entry ? parseConnectionPath(entry.path) : null;
						if (connName) setState((prev) => ({ ...prev, dbLevel: connName }));
					}
				},
			},
		];
	}, [totalCount, canGoUp, activeIndex, allEntries, handleGoUp, handleEntryClick, onClose, state.mode]);

	useShortcutScope({
		id: "overlay:at-panel",
		kind: "overlay",
		active: open,
		exclusive: false,
		bindings: keyBindings,
	});

	// ─── 点击外部关闭 ───
	useEffect(() => {
		if (!open) return;
		function handleClick(e: MouseEvent) {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		const timer = setTimeout(() => {
			document.addEventListener("mousedown", handleClick);
		}, 0);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("mousedown", handleClick);
		};
	}, [open, onClose]);

	useLayoutEffect(() => {
		if (!open || !shouldScrollActiveIntoViewRef.current) return;
		shouldScrollActiveIntoViewRef.current = false;
		panelRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open]);

	// ─── 显示的 heading meta ───
	const relDir = state.currentDir.startsWith(cwd) ? state.currentDir.slice(cwd.length) || "/" : state.currentDir;
	const headingMeta =
		state.mode === "files"
			? isSearching
				? t("atPanel.searchResults", { count: allEntries.length })
				: relDir
			: state.dbLevel
				? state.dbCatalog
					? `${state.dbLevel} · ${state.dbCatalog.name} · ${t("atPanel.tablesCount", { count: allEntries.length })}`
					: `${state.dbLevel} · ${t("atPanel.connectionsCount", { count: allEntries.length })}`
				: t("atPanel.connectionsCount", { count: state.dbConnections.length });

	// ─── Labels ───
	const labels: AtPanelLabels = {
		header: t("atPanel.header"),
		headingMeta,
		loading: t("atPanel.loading"),
		noResults: t("atPanel.noResults"),
		emptyDirectory: t("atPanel.emptyDirectory"),
		goUp: t("atPanel.goUp"),
		enterDirectory: t("atPanel.enterDirectory"),
		tabFiles: t("atPanel.tabFiles", { defaultValue: "Files" }),
		tabDatabase: t("atPanel.tabDatabase", { defaultValue: "Database" }),
		noConnections: t("atPanel.noConnections", { defaultValue: "No database connections" }),
	};

	// ─── 是否显示 tab 切换：至少有一个数据库连接才显示 ───
	const showTabs = state.dbConnections.length > 0;

	return {
		hidden: isSearchWithNoResults,
		viewProps: {
			open,
			loading,
			normalizedFilter,
			canGoUp,
			goUpActive: activeIndex === 0,
			entries: allEntries,
			labels,
			panelRef: panelRef as RefObject<HTMLDivElement | null>,
			className,
			classNames,
			onGoUp: handleGoUp,
			onHoverIndex: setActiveIndex,
			onEntryClick: handleEntryClick,
			mode: state.mode,
			onModeChange: showTabs ? handleModeChange : undefined,
		},
	};
}

// ─── helpers for type narrowing ───

interface DisplayItem {
	path: string;
	name: string;
	isDirectory: boolean;
	relPath?: string;
}
