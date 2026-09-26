import type { JSX } from "react";
import { Button, Spin, Switch } from "@astravia/ui";
import { useTranslation } from "react-i18next";
import type { DbConnection } from "../../../../preload/api-types/database";
import { DatabaseDetail } from "./DatabaseDetail";
import { DatabaseNotice } from "./DatabaseNotice";
import { ConnectionIdentity, endpointOf } from "./database-details-shared";
import { cn } from "@astravia/ui";
import type { DatabaseWorkspaceModel } from "../hooks/useDatabaseWorkspaceModel";

/**
 * 连接详情 · 管理视角（B2.6-U U3 按视角分离，供设置页数据库 tab 与 /database 路由使用）：
 *
 * 与工作台视角的去重策略（2026-09 重构）：
 * - 基础连接信息（host/db/env）合并进 ConnectionIdentity 头部一行 meta，不再单独 InfoSection ——
 *   工作台版的 InfoSection 保留原样（工作台需要完整连接信息用于查询上下文），
 *   管理版只做"管理"，不在两个视角间重复展示同一份 host/db/env。
 * - 管理策略区：AI 访问 + 生产写授权 **常驻展开**（产品层独有、工作台没有的）。
 *   连接 ID + 分组 **已移除**——低频字段，且"分组"目前没有实际功能，占位 UI 无意义。
 */
export function DatabaseConnectionDetails({
	model,
	selected,
}: {
	model: DatabaseWorkspaceModel;
	selected: DbConnection;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const selectedStatus = model.testSnapshots[selected.name]?.status ?? "untested";
	const testing = model.testingName === selected.name;

	const envLabel = t(selected.env === "prod" ? "databaseEnvProd" : "databaseEnvDev");
	const envVariant = selected.env === "prod" ? "text-destructive" : "text-emerald-500";

	return (
		<div>
			<ConnectionIdentity
				connection={selected}
				status={selectedStatus}
				statusLabel={t(`databaseStatus.${selectedStatus}`)}
				meta={
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
						<span className="inline-flex min-w-0 items-center gap-1 font-mono">
							<span className="icon-[lucide--server] h-3 w-3 shrink-0" />
							<span className="min-w-0 truncate">{endpointOf(selected)}</span>
						</span>
						<span className="opacity-30">·</span>
						<span className="inline-flex min-w-0 items-center gap-1 font-mono">
							<span className="icon-[lucide--database] h-3 w-3 shrink-0" />
							<span className="min-w-0 truncate">{selected.database || t("databaseNotSet")}</span>
						</span>
						<span className="opacity-30">·</span>
						<span className={cn("inline-flex items-center gap-1", envVariant)}>
							<span className="icon-[lucide--layers] h-3 w-3" />
							{envLabel}
						</span>
					</div>
				}
				actions={
					<>
						<Button
							variant="outline"
							size="xs"
							disabled={testing}
							onClick={() => void model.actions.testSaved(selected.name)}
						>
							{testing ? <Spin size="sm" /> : <span className="icon-[lucide--plug-zap] h-3 w-3" />}
							{testing ? t("databaseTesting") : t("databaseTest")}
						</Button>
						<Button
							variant="ghost"
							size="xs"
							className="text-muted-foreground hover:text-destructive"
							onClick={() => model.actions.remove(selected.name)}
						>
							<span className="icon-[lucide--trash-2] h-3.5 w-3.5" />
							{t("databaseRemoveConnection")}
						</Button>
					</>
				}
			/>

			<div className="mt-5 space-y-3">
				{/* ① 安全策略（常驻）：生产写授权 + AI 访问。prod 连接才显示前者。 */}
				{selected.env === "prod" ? (
					<div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
						<div className="min-w-0">
							<p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
								<span className="icon-[lucide--shield-alert] h-3.5 w-3.5 text-muted-foreground" />
								{t("databaseProdWriteApproved")}
							</p>
							<p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
								{t("databaseProdWriteApprovedDescription")}
							</p>
						</div>
						<Switch
							checked={model.prodWriteApproved[selected.name] === true}
							disabled={model.prodWriteApprovedBusy}
							onCheckedChange={() => model.actions.toggleProdWriteApproved(selected.name)}
						/>
					</div>
				) : null}

				<div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
					<div className="min-w-0">
						<p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
							<span className="icon-[lucide--bot] h-3.5 w-3.5 text-muted-foreground" />
							{t("databaseConnectionAiAccess")}
						</p>
						<p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
							{t("databaseConnectionAiAccessDescription")}
						</p>
					</div>
					<Switch
						checked={model.aiAccessEffective[selected.name] === true}
						disabled={model.connectionAiAccessBusy}
						onCheckedChange={() => model.actions.toggleConnectionAiAccess(selected.name)}
					/>
				</div>

				{/* ② 测试状态通知（成功/失败才显示）。 */}
				{selectedStatus === "ok" || selectedStatus === "failed" ? (
					<DatabaseNotice
						tone={selectedStatus === "ok" ? "success" : "error"}
						title={selectedStatus === "ok" ? t("databaseTestSuccess") : t("databaseTestFailedTitle")}
					>
						{selectedStatus === "failed" ? (
							<DatabaseDetail>{model.testSnapshots[selected.name]?.detail ?? ""}</DatabaseDetail>
						) : null}
					</DatabaseNotice>
				) : null}
			</div>
		</div>
	);
}
