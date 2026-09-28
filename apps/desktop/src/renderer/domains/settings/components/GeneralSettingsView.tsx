import { useUpdateCheckerModel } from "@shared/hooks/useUpdateCheckerModel";
import { UpdateCheckerAction, UpdateCheckerDetail } from "@vetta-org/theme-ui/overlays";
import { GeneralSettingsView as ThemeGeneralSettingsView } from "@vetta-org/theme-ui/settings";
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
	const showUpdateDetail =
		updates.phase === "available" || updates.phase === "downloading" || updates.phase === "ready";

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
					phase={updates.phase}
				/>
			}
			updatesDetail={
				showUpdateDetail ? (
					<UpdateCheckerDetail
						currentVersion={updates.currentVersion}
						labels={updates.labels}
						latestVersion={updates.latestVersion}
						onPrimary={updates.onPrimary}
						onViewMore={updates.onViewMore}
						phase={updates.phase}
						progress={updates.progress}
						releaseNote={updates.releaseNote}
					/>
				) : null
			}
			executionMode={model.executionMode}
			onExecutionModeChange={(mode) => void model.actions.changeExecutionMode(mode)}
			sandboxUnavailableReason={model.sandboxUnavailableReason}
			notifications={{
				sectionTitle: model.labels.sections.notifications,
				labels: {
					systemNotifications: model.labels.systemNotifications,
					systemNotificationsDescription: model.labels.systemNotificationsDescription,
					systemTiming: model.labels.notificationSystemTiming,
					soundTiming: model.labels.notificationSoundTiming,
					soundVolume: model.labels.notificationSoundVolume,
					events: model.labels.notificationEvents,
					eventCompleted: model.labels.notificationEventCompleted,
					eventFailed: model.labels.notificationEventFailed,
					eventActionRequired: model.labels.notificationEventActionRequired,
					systemBanner: model.labels.notificationSystemBanner,
					preview: model.labels.notificationPreview,
					noSound: model.labels.notificationNoSound,
					scopes: model.labels.notificationScopes,
					sounds: model.labels.notificationSounds,
				},
				notificationsEnabled: model.notificationsEnabled,
				value: model.notificationPreferences,
				onNotificationsEnabledChange: model.actions.toggleNotifications,
				onSystemScopeChange: model.actions.changeNotificationSystemScope,
				onSoundScopeChange: model.actions.changeNotificationSoundScope,
				onSoundVolumeChange: model.actions.changeNotificationSoundVolume,
				onEventSystemEnabledChange: model.actions.changeNotificationEventSystem,
				onEventSoundChange: model.actions.changeNotificationEventSound,
				onPreview: model.actions.previewNotificationSound,
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
