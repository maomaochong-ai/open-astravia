import type { JSX } from "react";
import { Button, Spin, Switch } from "@astravia/ui";
import { useTranslation } from "react-i18next";
import type { DbConnection } from "../../../../preload/api-types/database";
import { DatabaseDetail } from "./DatabaseDetail";
import { DatabaseNotice } from "./DatabaseNotice";
import { ConnectionIdentity, InfoItem, InfoSection, endpointOf } from "./database-details-shared";
import type { DatabaseWorkspaceModel } from "./useDatabaseWorkspaceModel";

/**
 * 连接详情 · 管理视角（B2.6-U U3 按视角分离，供设置页数据库 tab 与 /database 路由使用）：
 * 连接信息分区为主 + 管理动作组（测试连接 / 删除连接）。
 * AI 数据库感知开关已上移为设置页全局配置（B2.6-V V1）。
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

	return (
		<div>
			<ConnectionIdentity
				connection={selected}
				status={selectedStatus}
				statusLabel={t(`databaseStatus.${selectedStatus}`)}
				actions={
					<>
						<Button
							variant="outline"
							size="xs"
							disabled={testing}
							onClick={() => void model.actions.testSaved(selected.name)}
						>
							{testing ? <Spin size="sm" /> : <span className="icon-[mdi--connection] h-3 w-3" />}
							{testing ? t("databaseTesting") : t("databaseTest")}
						</Button>
						<Button
							variant="ghost"
							size="xs"
							className="text-muted-foreground hover:text-destructive"
							onClick={() => model.actions.remove(selected.name)}
						>
							<span className="icon-[mdi--delete-outline] h-3.5 w-3.5" />
							{t("databaseRemoveConnection")}
						</Button>
					</>
				}
			/>

			<div className="mt-5 space-y-4">
				<InfoSection icon="icon-[mdi--server-outline]" title={t("databaseSectionConnectionInfo")}>
					<InfoItem
						icon="icon-[mdi--server-outline]"
						label={t("databaseHost")}
						value={endpointOf(selected)}
						empty={!selected.host}
					/>
					<InfoItem
						icon="icon-[mdi--database-outline]"
						label={t("databaseDatabase")}
						value={selected.database || t("databaseNotSet")}
						empty={!selected.database}
					/>
					<InfoItem
						icon="icon-[mdi--layers-triple-outline]"
						label={t("databaseEnvironment")}
						value={t(selected.env === "prod" ? "databaseEnvProd" : "databaseEnvDev")}
					/>
				</InfoSection>

				<InfoSection icon="icon-[mdi--cog-outline]" title={t("databaseSectionManagement")}>
					<InfoItem icon="icon-[mdi--shape-outline]" label={t("databaseConnectionId")} value={selected.id} />
					<InfoItem
						icon="icon-[mdi--folder-outline]"
						label={t("databaseGroup")}
						value={selected.groupPath || t("databaseNotSet")}
						empty={!selected.groupPath}
					/>
					{selected.env === "prod" ? (
						<div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
							<div className="min-w-0">
								<p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
									<span className="icon-[mdi--shield-alert-outline] h-3.5 w-3.5 text-muted-foreground" />
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
					{/* B3.1-①-C 连接级「允许 AI 访问」白名单（生效值：显式配置 ?? env 缺省 prod 关 / dev 开）。 */}
					<div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
						<div className="min-w-0">
							<p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
								<span className="icon-[mdi--robot-outline] h-3.5 w-3.5 text-muted-foreground" />
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
				</InfoSection>

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
