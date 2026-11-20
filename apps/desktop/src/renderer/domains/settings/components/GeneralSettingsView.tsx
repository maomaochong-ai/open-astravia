import { useUpdateCheckerModel } from "@shared/hooks/useUpdateCheckerModel";
import { UpdateCheckerAction, UpdateCheckerDetail } from "@astravia-org/theme-ui/overlays";
import { GeneralSettingsView as ThemeGeneralSettingsView } from "@astravia-org/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import { ProxySettingsSection } from "./ProxySettingsSection";
import type { GeneralSettingsModel } from "./useGeneralSettingsModel";
import { useProxySettingsModel } from "./useProxySettingsModel";

export interface GeneralSettingsViewProps {
	model: GeneralSettingsModel;
}

/** Thin host adapter: model + updater pieces for SettingRow (no components/ui host chrome). */
export function GeneralSettingsView({ model }: GeneralSettingsViewProps): JSX.Element {
	const updates = useUpdateCheckerModel();
	const proxy = useProxySettingsModel();

	return (
		<ThemeGeneralSettingsView
			labels={model.labels}
			sections={{
				basics: SETTINGS_SECTION["general-basics"],
				notifications: SETTINGS_SECTION["general-notifications"],
				app: SETTINGS_SECTION["general-app"],
				developer: SETTINGS_SECTION["general-developer"],
			}}
			workspacePath={model.workspacePath}
			onSelectWorkspace={() => void model.actions.selectWorkspace()}
			onResetWorkspace={() => void model.actions.resetWorkspace()}
			updatesDescription={updates.statusText}
			updatesAction={
				<UpdateCheckerAction
					checking={updates.checking}
					labels={updates.labels}
					onCheck={updates.onCheck}
					// 「查看版本介绍」是同一行上的第二颗按钮。少了这一行，按钮不会渲染
					// （视图要求 label 与回调同时给），设置页就只剩「检查更新」。
					onViewCurrent={updates.onViewCurrent}
					phase={updates.phase}
					progress={updates.progress}
				/>
			}

			/*
			 * 详情卡片是下载 / 重启**唯一**的入口——更新对话框目前没有挂载点，所以这张卡片
			 * 不能被当成「重复的残留」删掉：上一版就删过一次，结果是用户看到「有新版本」
			 * 却没有按钮可点，Linux 打包 E2E 直接卡在 updater-detail 不出现。
			 *
			 * 用户当时真正抱怨的两件事在这里分别处理：不传 releaseNote，卡片里不再出现
			 * md 说明预览；下载进度只由顶部按钮表达，不在两处各显示一次。
			 */
			updatesDetail={
				<UpdateCheckerDetail
					currentVersion={updates.currentVersion}
					labels={updates.labels}
					latestVersion={updates.latestVersion}
					onPrimary={updates.onPrimary}
					onViewMore={updates.onViewMore}
					phase={updates.phase}
					progress={updates.progress}
				/>
			}

			executionMode={model.executionMode}
			onExecutionModeChange={(mode) => void model.actions.changeExecutionMode(mode)}
			sandboxUnavailableReason={model.sandboxUnavailableReason}
			notifications={{
				sectionTitle: model.labels.sections.notifications,
				labels: {
					systemNotifications: model.labels.systemNotifications,
					systemNotificationsDescription: model.labels.systemNotificationsDescription,
					soundNotifications: model.labels.notificationSound,
					soundNotificationsDescription: model.labels.notificationSoundDescription,
					soundTiming: model.labels.notificationSoundTiming,
					preview: model.labels.notificationPreview,
					previewAction: model.labels.notificationPreviewAction,
					scopes: model.labels.notificationScopes,
				},
				notificationsEnabled: model.notificationsEnabled,
				soundEnabled: model.notificationPreferences.soundEnabled,
				soundScope: model.notificationPreferences.soundScope,
				onNotificationsEnabledChange: model.actions.toggleNotifications,
				onSoundEnabledChange: model.actions.toggleSound,
				onSoundScopeChange: model.actions.changeNotificationSoundScope,
				onPreview: () => model.actions.previewNotificationSound(),
			}}
			debugMode={model.debugMode}
			onDebugChange={model.actions.toggleDebug}
			exportingDiagnostics={model.exportingDiagnostics}
			onExportDiagnostics={() => void model.actions.exportDiagnostics()}
			onStartAppGuide={model.actions.startAppGuide}
			networkSection={<ProxySettingsSection model={proxy} />}
		/>
	);
}
