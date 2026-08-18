import { ModelSelect } from "@shared/components/ModelSelect";
import { Button, Switch } from "@vetta/ui";
import { SettingHeading, SettingRow, SettingSection } from "@vetta/theme-ui/settings";
import { useTranslation } from "react-i18next";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import { ImChannelCard } from "./ImChannelCard";
import { ImFeishuDialog } from "./ImFeishuDialog";
import { ImLegacyImportBanner } from "./ImLegacyImportBanner";
import { ImLogDrawer } from "./ImLogDrawer";
import { ImStatusBadge } from "./ImStatusBadge";
import type { ImBridgeSettingsModel } from "./useImBridgeSettingsModel";
import { WechatBindDialog } from "./WechatBindDialog";

export function ImBridgeSettingsView({ model }: { model: ImBridgeSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");

	if (!model.config) {
		return (
			<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
				<h1 className="mb-6 text-[20px] font-bold text-foreground">Vetta Claw</h1>
				<div className="text-[13px] text-muted-foreground">{t("loadFailed")}</div>
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<h1 className="text-[20px] font-bold text-foreground">Vetta Claw</h1>
					<ImStatusBadge status={model.transportStatus} />
				</div>
				<SettingsAiAssist tabId="im" />
			</div>

			{model.legacy?.hasLegacyData && (
				<ImLegacyImportBanner
					legacy={model.legacy}
					importing={model.importing}
					onImport={model.onImportLegacy}
					onSkip={model.onSkipLegacy}
				/>
			)}

			{/* 基础：总开关 + 对话模型（原两个单行分区） */}
			<SettingSection section={SETTINGS_SECTION["imbridge-basics"]} title={t("section_imbridge-basics")}>
				<SettingRow title={t("enableImBridge")} description={t("enableImBridgeDesc")}>
					<Switch
						checked={model.config.enabled}
						onCheckedChange={(checked) => void model.onToggleEnabled(checked)}
						disabled={model.saving}
					/>
				</SettingRow>
				<SettingRow title={t("dialogModel")} description={t("dialogModelDesc")} border={false}>
					<div className="flex flex-wrap items-center justify-end gap-2">
						<ModelSelect
							value={
								model.config.agentModel
									? `${model.config.agentModel.provider}/${model.config.agentModel.model}`
									: null
							}
							onChange={(key) => {
								if (!key) {
									void model.onPickModel(null);
									return;
								}
								const sep = key.indexOf("/");
								if (sep < 0) return;
								void model.onPickModel({ provider: key.slice(0, sep), model: key.slice(sep + 1) });
							}}
							allowClear
							disabled={model.saving}
							placeholder={t("notSet")}
							triggerClassName="h-8 min-w-[220px] rounded-lg border-border bg-card px-2.5 text-[12px] font-medium hover:bg-accent data-[state=open]:bg-accent"
							reasoning={
								model.config.agentModel
									? {
											value: model.config.agentModel.reasoningLevel,
											onChange: (level) => {
												const agentModel = model.config?.agentModel;
												if (agentModel) {
													void model.onPickModel({
														provider: agentModel.provider,
														model: agentModel.model,
														reasoningLevel: level,
													});
												}
											},
										}
									: undefined
							}
						/>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void model.onProbeModel()}
							disabled={model.probing || !model.config.agentModel}
						>
							<span>{t("testConnect")}</span>
							{model.probing ? (
								<span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />
							) : model.probeResult?.ok ? (
								<span className="icon-[mdi--check] h-3.5 w-3.5 text-emerald-400" />
							) : model.probeResult && !model.probeResult.ok ? (
								<span className="icon-[mdi--close] h-3.5 w-3.5 text-destructive" />
							) : null}
						</Button>
					</div>
				</SettingRow>
			</SettingSection>

			{/* 消息渠道：飞书 / 微信卡片 */}
			<div className="mb-6 p-1.5" data-setting-section-highlight-target={SETTINGS_SECTION["imbridge-channels"].id}>
				<div className="mb-3 flex items-baseline gap-2">
					<SettingHeading
						section={SETTINGS_SECTION["imbridge-channels"]}
						title={t("section_imbridge-channels")}
					/>
					<span className="text-[12px] text-muted-foreground">{t("channelsCount")}</span>
				</div>
				<div className="grid grid-cols-2 gap-3">
					<ImChannelCard
						name={t("feishuName")}
						subtitle={t("feishuSubtitle")}
						iconClass="icon-[mdi--message-text] text-primary"
						configured={Boolean(model.config.feishu.appId)}
						isActive={model.config.transport === "feishu"}
						transportStatus={model.transportStatus}
						actionLabel={t("feishuSetting")}
						onAction={model.onOpenFeishuDialog}
						onActivate={
							model.config.transport === "feishu" ? undefined : () => void model.onSwitchTransport("feishu")
						}
					/>
					<ImChannelCard
						name={t("wechatName")}
						subtitle={
							model.config.wechat.bound
								? `${t("bound")} (${model.config.wechat.ilinkBotId ?? "iLink"})`
								: t("wechatSubtitle")
						}
						iconClass="icon-[mdi--wechat] text-emerald-400"
						configured={model.config.wechat.bound}
						isActive={model.config.transport === "wechat"}
						transportStatus={model.transportStatus}
						actionLabel={model.config.wechat.bound ? t("wechatManage") : t("wechatBind")}
						onAction={model.onOpenWechatDialog}
						onActivate={
							model.config.transport === "wechat" ? undefined : () => void model.onSwitchTransport("wechat")
						}
					/>
				</div>
			</div>

			<ImFeishuDialog model={model} />
			<WechatBindDialog
				open={model.wechatDialogOpen}
				onOpenChange={model.setWechatDialogOpen}
				bound={model.config.wechat.bound}
				ilinkBotId={model.config.wechat.ilinkBotId}
				ilinkUserId={model.config.wechat.ilinkUserId}
				onLogout={() => void model.onWechatLogout()}
				onConfirmedRefresh={model.onWechatConfirmedRefresh}
			/>

			{/* 状态与日志：进程信息 + 操作 */}
			<SettingSection section={SETTINGS_SECTION["imbridge-status"]} title={t("section_imbridge-status")}>
				<SettingRow
					title={t("bridgePid")}
					description={t("bridgePidDesc")}
					border={Boolean(model.status?.lastError)}
				>
					<span className="text-[13px] tabular-nums text-muted-foreground">{model.status?.sidecarPid ?? "—"}</span>
				</SettingRow>
				{model.status?.lastError && (
					<SettingRow title={t("lastError")} description={model.status.lastErrorAt ?? ""} border={false}>
						<span className="text-[12px] text-destructive">{model.status.lastError}</span>
					</SettingRow>
				)}
				<div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
					<Button variant="outline" size="sm" onClick={() => void model.onOpenLogs()}>
						{t("viewLogs")}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void model.onRestart()}
						disabled={!model.config.enabled}
					>
						{t("restartBridgeBtn")}
					</Button>
				</div>
			</SettingSection>

			{model.logsOpen && <ImLogDrawer logs={model.logs} onClose={() => model.setLogsOpen(false)} />}
		</div>
	);
}
