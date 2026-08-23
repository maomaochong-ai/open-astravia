import type { JSX, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { cn, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from "@astravia/ui";
import { useTranslation } from "react-i18next";
import type { DbConnection } from "../../../../preload/api-types/database";
import { getDatabaseTypeMeta } from "./database-type-catalog";
import { DatabaseBadge } from "./DatabaseBadge";
import { DatabaseSectionLabel } from "./DatabaseSectionLabel";
import { DatabaseStatusPill } from "./DatabaseStatus";
import { DatabaseSurface } from "./DatabaseSurface";
import { DatabaseTypeBadge } from "./DatabaseTypeBadge";
import type { DatabaseConnectionTestStatus, DatabaseWorkspaceModel } from "./useDatabaseWorkspaceModel";

export function endpointOf(connection: DbConnection): string {
	const meta = getDatabaseTypeMeta(connection.type);
	if (meta.fileBased) return connection.host;
	return connection.port ? `${connection.host}:${connection.port}` : connection.host;
}

/** 信息分区（连接信息 / 管理）：B2.6-W 反馈 2 卡片化 —— DatabaseSurface 软填充卡片分组，
 * 与提示卡（DatabaseNotice）同视觉语言，标题与信息区在卡内分层。 */
export function InfoSection({ icon, title, children }: { icon: string; title: string; children: ReactNode }): JSX.Element {
	return (
		<DatabaseSurface className="px-4 py-3.5">
			<DatabaseSectionLabel icon={icon} className="mb-3">
				{title}
			</DatabaseSectionLabel>
			<div className="grid grid-cols-1 gap-x-6 gap-y-4">{children}</div>
		</DatabaseSurface>
	);
}

export function InfoItem({
	icon,
	label,
	value,
	empty = false,
}: {
	icon: string;
	label: string;
	value: string;
	/** 空值（未设置）样式：弱化显示且不可复制。 */
	empty?: boolean;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<number | null>(null);

	useEffect(
		() => () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		},
		[],
	);

	const onCopy = (): void => {
		if (empty) return;
		void navigator.clipboard.writeText(value).then(
			() => {
				setCopied(true);
				if (timerRef.current !== null) window.clearTimeout(timerRef.current);
				timerRef.current = window.setTimeout(() => {
					setCopied(false);
					timerRef.current = null;
				}, 1500);
			},
			(error) => {
				console.warn("[database-details] copy failed", error);
			},
		);
	};

	return (
		<div className="min-w-0">
			<div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
				<span className={`h-3.5 w-3.5 shrink-0 ${icon}`} />
				{label}
			</div>
			<div className="mt-1 flex min-w-0 items-center gap-1.5">
				<span
					className={cn(
						"flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1",
						empty ? "border border-dashed text-[12px] text-muted-foreground/60" : "bg-muted/40",
					)}
				>
					<span
						className={cn(
							"min-w-0 truncate",
							!empty && "font-mono text-[12.5px] font-semibold text-foreground",
						)}
						title={value}
					>
						{value}
					</span>
					{!empty ? (
						<button
							type="button"
							onClick={onCopy}
							title={copied ? t("databaseCopied") : t("databaseCopyValue")}
							aria-label={copied ? t("databaseCopied") : t("databaseCopyValue")}
							className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/45 transition-colors hover:bg-background/70 hover:text-foreground"
						>
							<span
								className={cn(
									"h-3 w-3",
									copied ? "icon-[mdi--check] text-emerald-500" : "icon-[mdi--content-copy]",
								)}
							/>
						</button>
					) : null}
				</span>
			</div>
		</div>
	);
}

/** 详情标题区（类型徽章 + 名称 + 状态胶囊 + 右侧动作），管理/工作台两视角共用。 */
export function ConnectionIdentity({
	connection,
	status,
	statusLabel,
	actions,
}: {
	connection: DbConnection;
	status: DatabaseConnectionTestStatus;
	statusLabel: string;
	actions?: ReactNode;
}): JSX.Element {
	return (
		<div className="flex flex-wrap items-start justify-between gap-3">
			<div className="flex min-w-0 items-center gap-3">
				<DatabaseTypeBadge type={connection.type} size="md" />
				<div className="min-w-0">
					<h2 className="truncate text-[16px] font-bold text-foreground">{connection.name}</h2>
					<div className="mt-1 flex flex-wrap items-center gap-2">
						<DatabaseBadge>{getDatabaseTypeMeta(connection.type).label}</DatabaseBadge>
						<DatabaseStatusPill status={status} label={statusLabel} />
					</div>
				</div>
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
		</div>
	);
}

/** AI 数据库感知（schema 注入）开关行（B2.6-V V1 起仅设置页全局配置区使用）。 */
export function SchemaInjectionRow({ model }: { model: DatabaseWorkspaceModel }): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<DatabaseSurface className="flex items-start justify-between gap-4 px-4 py-3.5">
			<div className="flex min-w-0 items-start gap-2.5">
				<span className="icon-[mdi--brain] mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0">
					<p className="text-[12.5px] font-semibold text-foreground">{t("databaseSchemaInjection")}</p>
					<p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
						{t("databaseSchemaInjectionDescription")}
					</p>
				</div>
			</div>
			<Switch
				checked={model.schemaInjection}
				disabled={model.schemaInjectionBusy}
				onCheckedChange={() => void model.actions.toggleSchemaInjection()}
			/>
		</DatabaseSurface>
	);
}

/**
 * AI 访问数据库（dbx 工具注册）开关行（B2.10-W2 感知/访问权限分离）：
 * 控制 dbx MCP 工具是否注册进对话工具集——关闭后 AI 无法调用数据库工具执行 SQL。
 * 与 SchemaInjectionRow（仅注入表结构）相互独立，均在设置页全局配置区。
 */
export function DbxToolAccessRow({ model }: { model: DatabaseWorkspaceModel }): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<DatabaseSurface className="flex items-start justify-between gap-4 px-4 py-3.5">
			<div className="flex min-w-0 items-start gap-2.5">
				<span className="icon-[mdi--shield-lock-outline] mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0">
					<p className="text-[12.5px] font-semibold text-foreground">{t("databaseDbxToolAccess")}</p>
					<p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
						{t("databaseDbxToolAccessDescription")}
					</p>
				</div>
			</div>
			<Switch
				checked={model.dbxToolEnabled}
				disabled={model.dbxToolBusy}
				onCheckedChange={() => void model.actions.toggleDbxToolAccess()}
			/>
		</DatabaseSurface>
	);
}

/**
 * B3.1-①-B 安全执行模式开关行（全局配置区）：
 * strict（缺省，最严）——所有连接（含 dev）的写操作需显式授权；
 * relaxed——仅 prod 连接未授权时拦截（W4-② 原行为）。
 */
export function SafetyModeRow({ model }: { model: DatabaseWorkspaceModel }): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<DatabaseSurface className="flex items-start justify-between gap-4 px-4 py-3.5">
			<div className="flex min-w-0 items-start gap-2.5">
				<span className="icon-[mdi--shield-check-outline] mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0">
					<p className="text-[12.5px] font-semibold text-foreground">{t("databaseSafetyMode")}</p>
					<p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
						{t(
							model.safetyMode === "strict"
								? "databaseSafetyModeStrictDescription"
								: "databaseSafetyModeRelaxedDescription",
						)}
					</p>
				</div>
			</div>
			<Switch
				checked={model.safetyMode === "strict"}
				disabled={model.safetyModeBusy}
				onCheckedChange={() => model.actions.toggleSafetyMode()}
			/>
		</DatabaseSurface>
	);
}

/**
 * B3.1-② 执行限制行（全局配置区）：行数上限 + 查询超时。
 * rowLimit：结果行数上限（引擎最多返回 100 行，超过产品层截断并提示）；
 * queryTimeout：引擎调用超时（毫秒，UI 按秒展示）。
 */
export function DatabaseLimitsRow({ model }: { model: DatabaseWorkspaceModel }): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<DatabaseSurface className="flex flex-col gap-3 px-4 py-3.5">
			<div className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 items-start gap-2.5">
					<span className="icon-[mdi--format-list-numbered] mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<p className="text-[12.5px] font-semibold text-foreground">{t("databaseRowLimit")}</p>
						<p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{t("databaseRowLimitDescription")}</p>
					</div>
				</div>
				<Select
					value={String(model.rowLimit)}
					onValueChange={(value) => void model.actions.changeRowLimit(value)}
					disabled={model.rowLimitBusy}
				>
					<SelectTrigger size="sm" className="w-fit shrink-0">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{[50, 100, 200, 500].map((n) => (
							<SelectItem key={n} value={String(n)}>
								{n}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="flex items-start justify-between gap-4 border-t border-border/40 pt-3">
				<div className="flex min-w-0 items-start gap-2.5">
					<span className="icon-[mdi--timer-outline] mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<p className="text-[12.5px] font-semibold text-foreground">{t("databaseQueryTimeout")}</p>
						<p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{t("databaseQueryTimeoutDescription")}</p>
					</div>
				</div>
				<Select
					value={String(model.queryTimeoutMs / 1000)}
					onValueChange={(value) => void model.actions.changeQueryTimeout(value)}
					disabled={model.queryTimeoutBusy}
				>
					<SelectTrigger size="sm" className="w-fit shrink-0">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{[15, 30, 60, 120].map((seconds) => (
							<SelectItem key={seconds} value={String(seconds)}>
								{t("databaseQueryTimeoutSeconds", { seconds })}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</DatabaseSurface>
	);
}
