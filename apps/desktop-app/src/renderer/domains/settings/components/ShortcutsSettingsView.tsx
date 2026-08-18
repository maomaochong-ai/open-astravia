import { ShortcutsSettingsView as ThemeShortcutsSettingsView } from "@vetta/theme-ui/settings";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import { QuickPanelSettingsSection } from "./QuickPanelSettingsSection";
import { ShortcutRecorder } from "./ShortcutRecorder";
import type { ShortcutsSettingsModel } from "./useShortcutsSettingsModel";

export function ShortcutsSettingsView({ model }: { model: ShortcutsSettingsModel }): JSX.Element {
	return (
		<ThemeShortcutsSettingsView
			title={model.title}
			resetAllLabel={model.resetAllLabel}
			shortcutHint={model.shortcutHint}
			globalSection={SETTINGS_SECTION["shortcuts-global"]}
			globalSectionTitle={model.globalSectionTitle}
			aiAssistSlot={<SettingsAiAssist tabId="shortcuts" />}
			onResetAll={model.onResetAll}
			shortcutActions={model.shortcutActions.map((action) => ({
				id: action.id,
				label: action.label,
				description: action.description,
				recorder: (
					<ShortcutRecorder
						value={action.effectiveShortcut}
						onChange={(shortcut) => model.onShortcutChange(action.id, shortcut)}
						onReset={() => model.onShortcutReset(action.id)}
						isDefault={action.isDefault}
						placeholder={model.shortcutPlaceholder}
						resetLabel={model.resetLabel}
					/>
				),
			}))}
			quickPanelSection={
				<QuickPanelSettingsSection
					model={model.quickPanel}
					onTriggerChange={model.onQuickPanelTriggerChange}
					onBehaviorChange={model.onQuickPanelBehaviorChange}
				/>
			}
		/>
	);
}
