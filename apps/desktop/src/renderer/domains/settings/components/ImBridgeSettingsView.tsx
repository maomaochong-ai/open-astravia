import { ModelSelect } from "@shared/components/ModelSelect";
import { Button, Switch, cn } from "@vetta/ui";
import { ImChannelIconView, SettingHeading, SettingRow, SettingSection } from "@vetta/theme-ui/settings";
import { useTranslation } from "react-i18next";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import { ImChannelCard } from "./ImChannelCard";
import { FeishuBindDialog } from "./FeishuBindDialog";
import { ImFeishuDialog } from "./ImFeishuDialog";
import { ImLegacyImportBanner } from "./ImLegacyImportBanner";
import { ImLogDrawer } from "./ImLogDrawer";
import { ImStatusBadge } from "./ImStatusBadge";
import {
	IM_CHANNELS,
	isImChannelConfigured,
	type ImChannelDescriptor,
	type ImGenericChannelTransport,
} from "./im-channel-catalog";
import type { ImBridgeSettingsModel } from "./useImBridgeSettingsModel";
import { ImChannelConfigDialog } from "./ImChannelConfigDialog";
import { ImChannelGuideDialog } from "./ImChannelGuideDialog";
import { SignalBindDialog } from "./SignalBindDialog";
import { WechatBindDialog } from "./WechatBindDialog";

const GENERIC_CHANNEL_DESC_KEY = {
	telegram: "imChannelDialogDesc.telegram",
	slack: "imChannelDialogDesc.slack",
	discord: "imChannelDialogDesc.discord",
	signal: "imChannelDialogDesc.signal",
	whatsapp: "imChannelDialogDesc.whatsapp",
	imessage: "imChannelDialogDesc.imessage",
} as const satisfies Record<ImGenericChannelTransport, string>;

interface ChannelPresentation {
	readonly name: string;
	readonly subtitle: string;
	readonly configureLabel: string;
	readonly onConfigure: () => void;
}

export function ImBridgeSettingsView({ model }: { model: ImBridgeSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");
	const config = model.config;

	if (!config) {
		return (
			<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
				<h1 className="mb-6 text-[20px] font-bold text-foreground">Vetta Claw</h1>
				<div className="text-[13px] text-muted-foreground">{t("loadFailed")}</div>
			</div>
		);
	}

	const describe = (channel: ImChannelDescriptor): ChannelPresentation => {
		switch (channel.dialogKind) {
			case "feishu":
				return {
					name: t("feishuName"),
					subtitle: config.feishu.appId ? `${t("bound")} (${config.feishu.appId})` : t("feishuSubtitle"),
					configureLabel: config.feishu.appId ? t("feishuManage") : t("feishuBind"),
					onConfigure: model.onOpenFeishuBindDialog,
				};
			case "wechat":
				return {
					name: t("wechatName"),
					subtitle: config.wechat.bound
						? `${t("bound")} (${config.wechat.ilinkBotId ?? "iLink"})`
						: t("wechatSubtitle"),
					configureLabel: config.wechat.bound ? t("wechatManage") : t("wechatBind"),
					onConfigure: model.onOpenWechatDialog,
				};
			case "signal":
				return {
					name: channel.brandName,
					subtitle: config.signal.bound
						? `${t("bound")}${config.signal.account ? ` (${config.signal.account})` : ""}`
						: t("signalSubtitle"),
					configureLabel: config.signal.bound ? t("signalManage") : t("signalBind"),
					onConfigure: model.onOpenSignalDialog,
				};
			case "generic":
				return {
					name: channel.brandName,
					subtitle: t(GENERIC_CHANNEL_DESC_KEY[channel.transport]),
					configureLabel: t("configureChannel"),
					onConfigure: () => model.onOpenChannelDialog(channel.transport),
				};
		}
	};

	const activeChannel = IM_CHANNELS.find((channel) => channel.transport === config.transport) ?? IM_CHANNELS[0];
	const activePresentation = describe(activeChannel);
	const feedback = model.saveError ?? model.saveOk;
	const feedbackIsError = model.saveError !== null;

	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-[20px] font-bold text-foreground">Vetta Claw</h1>
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

			{feedback && (
				<div
					role="status"
					className={cn(
						"mb-4 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[12px]",
						feedbackIsError
							? "border-destructive/40 bg-destructive/10 text-destructive"
							: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
					)}
				>
					<span
						className={cn(
							feedbackIsError
								? "icon-[solar--danger-triangle-linear]"
								: "icon-[solar--check-circle-linear]",
							"mt-px h-3.5 w-3.5 shrink-0",
						)}
					/>
					<span className="min-w-0 flex-1">{feedback}</span>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={t("imbDismissMessage")}
						title={t("imbDismissMessage")}
						onClick={model.onDismissFeedback}
					>
						<span className="icon-[solar--close-circle-linear] h-3 w-3" />
					</Button>
				</div>
			)}

			{/* 概览：当前活动渠道与连接状态 + 总开关 + 对话模型 */}
			<SettingSection section={SETTINGS_SECTION["imbridge-basics"]} title={false}>
				<div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
					<ImChannelIconView icon={activeChannel.icon} isActive className="h-10 w-10" />
					<div className="min-w-0 flex-1 basis-40">
						<div className="truncate text-[15px] font-semibold text-foreground">
							{activePresentation.name}
						</div>
						<div className="mt-0.5 truncate text-[12px] text-muted-foreground">
							{t("imbActiveChannel")} · {activePresentation.subtitle}
						</div>
					</div>
					<ImStatusBadge status={model.transportStatus} />
				</div>
				<SettingRow title={t("enableImBridge")} description={t("enableImBridgeDesc")}>
					<Switch
						checked={config.enabled}
						onCheckedChange={(checked) => void model.onToggleEnabled(checked)}
						disabled={model.saving}
					/>
				</SettingRow>
				<SettingRow title={t("dialogModel")} description={t("dialogModelDesc")} border={false}>
					<div className="flex flex-wrap items-center justify-end gap-2">
						<ModelSelect
							value={config.agentModel ? `${config.agentModel.provider}/${config.agentModel.model}` : null}
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
								config.agentModel
									? {
											value: config.agentModel.reasoningLevel,
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
							disabled={model.probing || !config.agentModel}
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

			{/* 消息渠道：同时只有一个活动渠道，其余为待用配置 */}
			<div className="mb-6 p-1.5" data-setting-section-highlight-target={SETTINGS_SECTION["imbridge-channels"].id}>
				<div className="mb-3 flex items-baseline gap-2">
					<SettingHeading
						section={SETTINGS_SECTION["imbridge-channels"]}
						title={t("section_imbridge-channels")}
					/>
					<span className="text-[12px] text-muted-foreground">
						{t("channelsCountValue", { count: IM_CHANNELS.length })}
					</span>
				</div>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
					{IM_CHANNELS.map((channel) => {
						const presentation = describe(channel);
						const isActive = config.transport === channel.transport;
						return (
							<ImChannelCard
								key={channel.transport}
								name={presentation.name}
								subtitle={presentation.subtitle}
								icon={channel.icon}
								configured={isImChannelConfigured(config, channel.transport)}
								isActive={isActive}
								transportStatus={model.transportStatus}
								configureLabel={presentation.configureLabel}
								onConfigure={presentation.onConfigure}
								onActivate={
									isActive ? undefined : () => void model.onSwitchTransport(channel.transport)
								}
							/>
						);
					})}
				</div>
			</div>

			<ImFeishuDialog model={model} />
			<FeishuBindDialog
				onOpenGuide={() => model.setGuideTransport("feishu")}
				open={model.feishuBindDialogOpen}
				onOpenChange={model.setFeishuBindDialogOpen}
				bound={Boolean(config.feishu.appId)}
				appId={config.feishu.appId || undefined}
				onLogout={() => void model.onClearChannel("feishu")}
				onConfirmedRefresh={model.onFeishuConfirmedRefresh}
				onOpenManual={model.onOpenFeishuDialog}
			/>
			<ImChannelConfigDialog model={model.channelDialog} onOpenGuide={(transport) => model.setGuideTransport(transport)} />
			<WechatBindDialog
				onOpenGuide={() => model.setGuideTransport("wechat")}
				open={model.wechatDialogOpen}
				onOpenChange={model.setWechatDialogOpen}
				bound={config.wechat.bound}
				ilinkBotId={config.wechat.ilinkBotId}
				ilinkUserId={config.wechat.ilinkUserId}
				onLogout={() => void model.onWechatLogout()}
				onConfirmedRefresh={model.onWechatConfirmedRefresh}
			/>
			<SignalBindDialog
				onOpenGuide={() => model.setGuideTransport("signal")}
				open={model.signalDialogOpen}
				onOpenChange={model.setSignalDialogOpen}
				bound={config.signal.bound}
				account={config.signal.account}
				cliDetectedPath={config.signal.cliDetectedPath}
				cliInstallHint={config.signal.cliInstallHint}
				onLogout={() => void model.onSignalLogout()}
				onConfirmedRefresh={model.onSignalConfirmedRefresh}
				onOpenAdvanced={() => model.onOpenChannelDialog("signal")}
			/>
			<ImChannelGuideDialog transport={model.guideTransport} onClose={() => model.setGuideTransport(null)} />

			{/* 状态与日志：一条紧凑的进程信息栏 */}
			<SettingSection section={SETTINGS_SECTION["imbridge-status"]} title={t("section_imbridge-status")}>
				<div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
					<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
						<span className="text-muted-foreground">
							{t("bridgePid")}
							<span className="ml-1.5 tabular-nums text-foreground">{model.status?.sidecarPid ?? "—"}</span>
						</span>
						{model.status?.lastError && (
							<span
								className="min-w-0 truncate text-destructive"
								title={`${model.status.lastErrorAt ?? ""} ${model.status.lastError}`}
							>
								{model.status.lastError}
							</span>
						)}
					</div>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" onClick={() => void model.onOpenLogs()}>
							<span className="icon-[solar--document-text-linear] h-3.5 w-3.5" />
							{t("viewLogs")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void model.onRestart()}
							disabled={!config.enabled}
						>
							<span className="icon-[solar--restart-linear] h-3.5 w-3.5" />
							{t("restartBridgeBtn")}
						</Button>
					</div>
				</div>
			</SettingSection>

			{model.logsOpen && <ImLogDrawer logs={model.logs} onClose={() => model.setLogsOpen(false)} />}
		</div>
	);
}
