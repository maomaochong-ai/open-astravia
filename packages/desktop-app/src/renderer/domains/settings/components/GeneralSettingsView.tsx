import { useUpdateCheckerModel } from "@shared/hooks/useUpdateCheckerModel";
import { UpdateCheckerAction, UpdateCheckerDetail } from "@vetta/theme-ui/overlays";
import { GeneralSettingsView as ThemeGeneralSettingsView } from "@vetta/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { GeneralSettingsModel } from "./useGeneralSettingsModel";

export interface GeneralSettingsViewProps {
	model: GeneralSettingsModel;
}

/** Thin host adapter: model + updater pieces for SettingRow (no components/ui host chrome). */
export function GeneralSettingsView({ model }: GeneralSettingsViewProps): JSX.Element {
	const updates = useUpdateCheckerModel();
	const showUpdateDetail =
		updates.phase === "available" || updates.phase === "downloading" || updates.phase === "ready";

	return (
		<ThemeGeneralSettingsView
			labels={model.labels}
			sections={{
				basics: SETTINGS_SECTION["general-basics"],
				app: SETTINGS_SECTION["general-app"],
				developer: SETTINGS_SECTION["general-developer"],
			}}
			workspacePath={model.workspacePath}
			onSelectWorkspace={() => void model.actions.selectWorkspace()}
			onResetWorkspace={() => void model.actions.resetWorkspace()}
			updatesDescription={updates.statusText}
			updatesAction={
				<UpdateCheckerAction checking={updates.checking} labels={updates.labels} onCheck={updates.onCheck} />
			}
			updatesDetail={
				showUpdateDetail ? (
					<UpdateCheckerDetail
						currentVersion={updates.currentVersion}
						labels={updates.labels}
						latestVersion={updates.latestVersion}
						onPrimary={updates.onPrimary}
						phase={updates.phase}
						progress={updates.progress}
						releaseNote={updates.releaseNote}
					/>
				) : null
			}
			executionMode={model.executionMode}
			onExecutionModeChange={(mode) => void model.actions.changeExecutionMode(mode)}
			sandboxUnavailableReason={model.sandboxUnavailableReason}
			notificationsEnabled={model.notificationsEnabled}
			onNotificationsChange={model.actions.toggleNotifications}
			debugMode={model.debugMode}
			onDebugChange={model.actions.toggleDebug}
			exportingDiagnostics={model.exportingDiagnostics}
			onExportDiagnostics={() => void model.actions.exportDiagnostics()}
			onStartAppGuide={model.actions.startAppGuide}
		/>
	);
}
