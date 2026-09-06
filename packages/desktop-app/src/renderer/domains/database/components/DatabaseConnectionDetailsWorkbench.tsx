import type { JSX } from "react";
import { Button, Spin } from "@astravia/ui";
import { useTranslation } from "react-i18next";
import type { DbConnection } from "../../../../preload/api-types/database";
import { DatabaseDetail } from "./DatabaseDetail";
import { DatabaseNotice } from "./DatabaseNotice";
import { ConnectionIdentity, InfoItem, InfoSection, endpointOf } from "./database-details-shared";
import type { DatabaseWorkspaceModel } from "../hooks/useDatabaseWorkspaceModel";

/**
 * 连接详情 · 工作台视角（B2.6-U U3 按视角分离，供活动面板「数据库」标签页使用）：
 * 聚焦查询工作流 —— 状态 + 快速测试 + 精简连接信息；
 * 不含低频管理动作（删除 / 连接 ID / 分组）与 AI 数据库感知开关
 * （开关已上移为设置页全局配置，B2.6-V V1），管理动作收敛到设置页管理视角。
 */
export function DatabaseConnectionDetailsWorkbench({
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
					<Button
						variant="outline"
						size="xs"
						disabled={testing}
						title={t("databaseTest")}
						onClick={() => void model.actions.testSaved(selected.name)}
					>
						{testing ? <Spin size="sm" /> : <span className="icon-[mdi--connection] h-3 w-3" />}
						{testing ? t("databaseTesting") : t("databaseTest")}
					</Button>
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

				<DatabaseNotice tone="info" icon="icon-[mdi--shield-lock-outline]" title={t("databaseEngineNote")} />
			</div>
		</div>
	);
}
