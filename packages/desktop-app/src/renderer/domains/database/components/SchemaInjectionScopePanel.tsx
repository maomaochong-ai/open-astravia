import type { JSX } from "react";
import { cn, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spin } from "@astravia/ui";
import { useTranslation } from "react-i18next";
import type { DbTableInfo } from "../../../../preload/api-types/database";
import { DatabaseSurface } from "./DatabaseSurface";
import type { DatabaseWorkspaceModel, SchemaInjectionScopeKind } from "../hooks/useDatabaseWorkspaceModel";

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

	return (
		<DatabaseSurface className="px-4 py-3.5">
			<div className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 items-start gap-2.5">
					<span className="icon-[solar--filter-linear] mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
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
					<p className="text-[11px] font-medium text-muted-foreground">{t("databaseSchemaInjectionScopeTablesHint")}</p>
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
					active ? "icon-[solar--check-circle-linear] text-primary" : "icon-[solar--circle-linear] text-muted-foreground/50",
				)}
			/>
			<span className="max-w-48 truncate">{label}</span>
		</button>
	);
}

/** 单个连接的组：连接名 + 懒加载的表 chips（点击加载）。 */
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
	const selectedTables = model.schemaInjectionScope.tables
		.filter((item) => item.connection === connectionName)
		.map((item) => item.table);

	return (
		<div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
			<div className="flex items-center justify-between gap-2">
				<span className="min-w-0 truncate text-[12px] font-semibold text-foreground">{connectionName}</span>
				{tables ? (
					<span className="shrink-0 text-[11px] text-muted-foreground">
						{selectedTables.length}/{tables.length}
					</span>
				) : (
					<button
						type="button"
						onClick={() => void model.actions.loadConnectionTables(connectionName)}
						disabled={loading}
						className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:underline disabled:cursor-wait disabled:opacity-60"
					>
						{loading ? (
							<Spin size="sm" className="h-3.5 w-3.5 text-primary" />
						) : (
							<span className="icon-[solar--alt-arrow-down-linear] h-3 w-3" />
						)}
						{t("databaseSchemaInjectionScopeLoadTables")}
					</button>
				)}
			</div>
			{tables ? (
				tables.length === 0 ? (
					<p className="mt-1.5 text-[12px] text-muted-foreground/70">{t("databaseNoTables")}</p>
				) : (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{tables.map((table) => (
							<ScopeChip
								key={table.name}
								label={table.name}
								active={selectedTables.includes(table.name)}
								onClick={() => model.actions.toggleScopeTable(connectionName, table.name)}
							/>
						))}
					</div>
				)
			) : null}
		</div>
	);
}
