import type { JSX } from "react";
import { cn, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spin } from "@astravia/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DbTableInfo } from "../../../../preload/api-types/database";
import { DatabaseSurface } from "./DatabaseSurface";
import type { DatabaseWorkspaceModel, SchemaInjectionScopeKind } from "../hooks/useDatabaseWorkspaceModel";

/** 默认折叠阈值：超过 MAX_TABLES_BEFORE_COLLAPSE 张表时默认收起（除非有已选）。 */
const MAX_TABLES_BEFORE_COLLAPSE = 10;

/**
 * 感知范围面板（B2.10-W4-①）：AI 数据库感知开启时，选择注入到 AI 对话的
 * schema 范围——全部连接 / 指定连接 / 指定表。任何变更即时持久化 + 埋点。
 * 仅随 SchemaInjectionRow 一起渲染（开关关闭时不展示）。
 */
export function SchemaInjectionScopePanel({ model }: { model: DatabaseWorkspaceModel }): JSX.Element {
	const { t } = useTranslation("settings");
	const { schemaInjectionScope: scope } = model;

	const selectScopeKind = (value: string): void => {
		if (value === "all" || value === "connections" || value === "tables") {
			model.actions.setSchemaInjectionScopeKind(value as SchemaInjectionScopeKind);
		}
	};

	// 指定表模式顶部汇总：已选总表数 / 已选连接数 + 一键清空。
	const totalSelectedTables = useMemo(() => scope.tables.length, [scope.tables]);
	const totalSelectedConnections = useMemo(() => new Set(scope.tables.map((t) => t.connection)).size, [scope.tables]);

	return (
		<DatabaseSurface className="px-4 py-3.5">
			<div className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 items-start gap-2.5">
					<span className="icon-[lucide--filter] mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<p className="text-[12.5px] font-semibold text-foreground">{t("databaseSchemaInjectionScope")}</p>
						<p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
							{t("databaseSchemaInjectionScopeDescription")}
						</p>
					</div>
				</div>
				<Select value={scope.scope} onValueChange={selectScopeKind} disabled={model.schemaInjectionScopeBusy}>
					<SelectTrigger size="sm" className="w-fit shrink-0">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">{t("databaseSchemaInjectionScopeAll")}</SelectItem>
						<SelectItem value="connections">{t("databaseSchemaInjectionScopeConnections")}</SelectItem>
						<SelectItem value="tables">{t("databaseSchemaInjectionScopeTables")}</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{scope.scope === "connections" ? (
				<div className="mt-3">
					<p className="text-[11px] font-medium text-muted-foreground">
						{t("databaseSchemaInjectionScopeConnectionsHint")}
					</p>
					{model.connections.length === 0 ? (
						<p className="mt-2 text-[12px] text-muted-foreground/70">{t("databaseEmpty")}</p>
					) : (
						<div className="mt-2 flex flex-wrap gap-1.5">
							{model.connections.map((connection) => (
								<ScopeChip
									key={connection.id}
									label={connection.name}
									active={scope.connections.includes(connection.name)}
									onClick={() => model.actions.toggleScopeConnection(connection.name)}
								/>
							))}
						</div>
					)}
				</div>
			) : null}

			{scope.scope === "tables" ? (
				<div className="mt-3">
					<div className="flex items-center justify-between gap-3">
						<p className="text-[11px] font-medium text-muted-foreground">{t("databaseSchemaInjectionScopeTablesHint")}</p>
						{totalSelectedTables > 0 ? (
							<div className="flex items-center gap-2">
								<span className="text-[11px] text-muted-foreground">
									已选 <span className="font-semibold text-primary">{totalSelectedTables}</span> 张表
									· {totalSelectedConnections} 个连接
								</span>
								<button
									type="button"
									onClick={() => model.actions.clearScopeTables()}
									className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
								>
									清空
								</button>
							</div>
						) : null}
					</div>
					{model.connections.length === 0 ? (
						<p className="mt-2 text-[12px] text-muted-foreground/70">{t("databaseEmpty")}</p>
					) : (
						<div className="mt-2 space-y-2">
							{model.connections.map((connection) => (
								<ConnectionTableGroup key={connection.id} model={model} connectionName={connection.name} />
							))}
						</div>
					)}
				</div>
			) : null}
		</DatabaseSurface>
	);
}

/** 可切换选择 chip（列表选择项，允许原生 button）。 */
function ScopeChip({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			className={cn(
				"flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors",
				active
					? "border-primary/40 bg-primary/10 text-foreground ring-1 ring-inset ring-primary/30"
					: "border-border bg-card text-muted-foreground hover:bg-accent",
			)}
		>
			<span
				className={cn(
					"h-3 w-3 shrink-0",
					active ? "icon-[lucide--circle-check] text-primary" : "icon-[lucide--circle] text-muted-foreground/50",
				)}
			/>
			<span className="max-w-48 truncate">{label}</span>
		</button>
	);
}

/** 单个连接的组：搜索框 + 折叠状态 + 懒加载 + 紧凑表 chip 网格。 */
function ConnectionTableGroup({
	model,
	connectionName,
}: {
	model: DatabaseWorkspaceModel;
	connectionName: string;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const tables = model.connectionTables[connectionName] as readonly DbTableInfo[] | undefined;
	const loading = model.loadingTablesFor === connectionName;
	const selectedTables = useMemo(
		() => model.schemaInjectionScope.tables.filter((item) => item.connection === connectionName).map((item) => item.table),
		[model.schemaInjectionScope.tables, connectionName],
	);

	// 搜索框输入（只过滤当前连接的表）。
	const [filter, setFilter] = useState("");
	// 折叠状态：默认已选 > 0 或表总数 ≤ 10 时展开，否则折叠。
	const hasPreselection = selectedTables.length > 0;
	const defaultOpen = hasPreselection || (tables ? tables.length <= MAX_TABLES_BEFORE_COLLAPSE : true);
	const [open, setOpen] = useState(defaultOpen);

	const filteredTables = useMemo(() => {
		if (!tables) return undefined;
		if (!filter.trim()) return tables;
		const needle = filter.trim().toLowerCase();
		return tables.filter((table) => table.name.toLowerCase().includes(needle));
	}, [tables, filter]);

	// 过滤激活时强制展开；clear filter 时保留用户手动状态。
	const isFilterActive = filter.trim().length > 0;

	return (
		<div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
			{/* 组头：连接名 + 已选计数 + 加载/折叠按钮 */}
			<div className="flex items-center justify-between gap-2">
				<button
					type="button"
					onClick={() => {
						if (!tables) {
							void model.actions.loadConnectionTables(connectionName);
						} else if (isFilterActive) {
							setFilter("");
						} else {
							setOpen((v) => !v);
						}
					}}
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
				>
					<span
						className={cn(
							"h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform",
							open && !isFilterActive ? "rotate-90" : "",
						)}
					>
						<span className="icon-[lucide--chevron-right] block h-full w-full" />
					</span>
					<span className="min-w-0 truncate text-[12px] font-semibold text-foreground">{connectionName}</span>
					{tables ? (
						<span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10.5px] font-medium text-muted-foreground">
							{selectedTables.length}/{tables.length}
						</span>
					) : null}
				</button>
				{!tables ? (
					<button
						type="button"
						onClick={() => void model.actions.loadConnectionTables(connectionName)}
						disabled={loading}
						className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:underline disabled:cursor-wait disabled:opacity-60"
					>
						{loading ? (
							<Spin size="sm" className="h-3.5 w-3.5 text-primary" />
						) : (
							<span className="icon-[lucide--download] h-3 w-3" />
						)}
						{t("databaseSchemaInjectionScopeLoadTables")}
					</button>
				) : null}
			</div>

			{tables ? (
				tables.length === 0 ? (
					<p className="mt-1.5 text-[12px] text-muted-foreground/70">{t("databaseNoTables")}</p>
				) : (
					open || isFilterActive ? (
						<div className="mt-2">
							{/* 搜索框 */}
							{tables.length > 1 ? (
								<div className="mb-2 flex items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-1 focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20">
									<span className="icon-[lucide--search] h-3.5 w-3.5 text-muted-foreground/60" />
									<input
										type="text"
										value={filter}
										onChange={(e) => setFilter(e.target.value)}
										placeholder={`在 ${connectionName} 中搜索表…`}
										className="min-w-0 flex-1 bg-transparent text-[11.5px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
									/>
									{filter ? (
										<button
											type="button"
											onClick={() => setFilter("")}
											className="text-muted-foreground/60 hover:text-foreground"
											aria-label="清除搜索"
										>
											<span className="icon-[lucide--x] h-3 w-3" />
										</button>
									) : null}
								</div>
							) : null}

							{filteredTables && filteredTables.length === 0 ? (
								<p className="py-1 text-[11.5px] text-muted-foreground/70">无匹配的表</p>
							) : (
								<div className="flex flex-wrap gap-1.5">
									{(filteredTables ?? []).map((table) => (
										<ScopeChip
											key={table.name}
											label={table.name}
											active={selectedTables.includes(table.name)}
											onClick={() => model.actions.toggleScopeTable(connectionName, table.name)}
										/>
									))}
								</div>
							)}

							{!isFilterActive && tables.length > MAX_TABLES_BEFORE_COLLAPSE ? (
								<button
									type="button"
									onClick={() => setOpen(false)}
									className="mt-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
								>
									收起
								</button>
							) : null}
						</div>
					) : (
						<button
							type="button"
							onClick={() => setOpen(true)}
							className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:underline"
						>
							<span className="icon-[lucide--chevron-down] h-3 w-3" />
							展开 {tables.length} 张表{selectedTables.length > 0 ? `（已选 ${selectedTables.length}）` : ""}
						</button>
					)
				)
			) : null}
		</div>
	);
}
