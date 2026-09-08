import { Button } from "@astravia/ui";
import { SettingsAiAssist } from "../../settings/ai-assist";
import { SettingHeading } from "@astravia/theme-ui/settings";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import {
	DatabaseLimitsRow,
	DbxToolAccessRow,
	SafetyModeRow,
	SchemaInjectionRow,
	ToolPrefsAutoRefreshRow,
	ToolPrefsPageSizeRow,
} from "./database-details-shared";
import { SchemaInjectionScopePanel } from "./SchemaInjectionScopePanel";
import { useDatabaseWorkspaceModel } from "../hooks/useDatabaseWorkspaceModel";
import type { DatabaseWorkspaceModel } from "../hooks/useDatabaseWorkspaceModel";

/**
 * 设置中心「数据库」标签页的设置面板。
 *
 * 与 /database 路由（连接管理页）职责分离：
 * - 本面板只承载「与连接无关的全局设置」——工具偏好（结果分页/自动刷新）、执行与安全
 *   （安全模式、行数上限、查询超时）、AI 数据库协作（schema 注入/工具访问 + 空态引导）；
 * - 连接列表 / 详情 / 新增编辑删除等管理动作全部在 /database 连接管理页；
 * - AI 协作区在未配置任何模型时折叠为空态引导，不摆无意义的开关。
 */
function SettingsPanelContent({ model }: { model: DatabaseWorkspaceModel }): JSX.Element {
	const { t } = useTranslation("settings");
	const navigate = useNavigate();

	// AI 协作区折叠判定：本机是否已配置任一 AI provider 或默认模型。
	const [hasAiProvider, setHasAiProvider] = useState(false);
	useEffect(() => {
		let cancelled = false;
		void window.astravia.models.get().then((config) => {
			if (cancelled) return;
			const anyProvider = Object.values(config?.providers ?? {}).some(
				(provider) => Boolean(provider?.credentialRef || provider?.apiKey),
			);
			setHasAiProvider(Boolean(config?.defaultModel) || anyProvider);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const goToModels = (): void => {
		void navigate({ to: "/settings/$tab", params: { tab: "models" } });
	};

	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-[20px] font-bold text-foreground">{t("databaseTitle")}</h1>
				<SettingsAiAssist tabId="database" triggerLabel={t("databaseConnectionAssistant")} />
			</div>

			{/* 工具偏好：结果默认每页行数 / 自动刷新 */}
			<div className="mb-6">
				<SettingHeading
					title={t("databaseSectionTooling")}
					section={{ id: "database-tooling" }}
					className="mb-1"
				/>
				<p className="mb-4 text-[12px] text-muted-foreground">{t("databaseSectionToolingDescription")}</p>
				<div className="space-y-2.5">
					<ToolPrefsPageSizeRow model={model} />
					<ToolPrefsAutoRefreshRow model={model} />
				</div>
			</div>

			{/* 执行与安全：安全模式 / 行数上限 / 查询超时 */}
			<div className="mb-6">
				<SettingHeading
					title={t("databaseSectionSafety")}
					section={{ id: "database-safety" }}
					className="mb-1"
				/>
				<p className="mb-4 text-[12px] text-muted-foreground">{t("databaseSectionSafetyDescription")}</p>
				<div className="space-y-2.5">
					<SafetyModeRow model={model} />
					<DatabaseLimitsRow model={model} />
				</div>
				<div className="mt-2.5 flex items-start gap-2 px-1">
					<span className="icon-[mdi--shield-lock-outline] mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					<p className="text-[12px] leading-relaxed text-muted-foreground">{t("databaseEngineNote")}</p>
				</div>
			</div>

			{/* AI 数据库协作 */}
			<div className="mb-6">
				<SettingHeading
					title={t("databaseSectionAi")}
					section={{ id: "database-ai" }}
					className="mb-1"
				/>
				<p className="mb-4 text-[12px] text-muted-foreground">{t("databaseSectionAiDescription")}</p>
				{hasAiProvider ? (
					<div className="space-y-2.5">
						<SchemaInjectionRow model={model} />
						{model.schemaInjection ? <SchemaInjectionScopePanel model={model} /> : null}
						<DbxToolAccessRow model={model} />
					</div>
				) : (
					<div className="flex items-center justify-between gap-4 rounded-xl bg-muted/40 px-4 py-3.5">
						<div className="flex min-w-0 items-start gap-2.5">
							<span className="icon-[lucide--sparkles] mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
							<p className="min-w-0 text-[12px] leading-relaxed text-muted-foreground">{t("databaseAiEmptyHint")}</p>
						</div>
						<Button variant="outline" size="xs" className="shrink-0" onClick={goToModels}>
							<span className="icon-[lucide--bot] h-3.5 w-3.5" />
							{t("databaseAiEmptyAction")}
						</Button>
					</div>
				)}
			</div>

			{/* 凭据风险提示：不单独占整卡，作为执行与安全区底部小字（无交互只读说明）。 */}
			<div className="mt-2 flex items-start gap-2 px-1">
				<span className="icon-[mdi--shield-alert-outline] mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<p className="text-[12px] leading-relaxed text-muted-foreground">{t("databaseCredentialRiskNote")}</p>
			</div>
		</div>
	);
}

export function DatabaseSettingsPanel(): JSX.Element {
	const model = useDatabaseWorkspaceModel();
	return <SettingsPanelContent model={model} />;
}
