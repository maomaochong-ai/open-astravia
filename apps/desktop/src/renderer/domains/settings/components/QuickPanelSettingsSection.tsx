import { QuickPanelSettingsSectionView } from "@vetta/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { QuickPanelBehavior, QuickPanelTrigger, ShortcutsSettingsModel } from "./useShortcutsSettingsModel";

type QuickPanelModel = ShortcutsSettingsModel["quickPanel"];

export function QuickPanelSettingsSection({
	model,
	onTriggerChange,
	onBehaviorChange,
}: {
	model: QuickPanelModel;
	onTriggerChange: (trigger: QuickPanelTrigger) => void;
	onBehaviorChange: (behavior: QuickPanelBehavior) => void;
}): JSX.Element {
	return (
		<QuickPanelSettingsSectionView
			section={SETTINGS_SECTION["shortcuts-quickpanel"]}
			sectionTitle={model.sectionTitle}
			triggerTitle={model.triggerTitle}
			triggerDescription={model.triggerDescription}
			trigger={model.trigger}
			triggerOptions={model.triggerOptions}
			onTriggerChange={(value) => onTriggerChange(value as QuickPanelTrigger)}
			behaviorTitle={model.behaviorTitle}
			behaviorDescription={model.behaviorDescription}
			behavior={model.behavior}
			behaviorOptions={model.behaviorOptions}
			onBehaviorChange={(value) => onBehaviorChange(value as QuickPanelBehavior)}
			behaviorDisabled={model.behaviorDisabled}
		/>
	);
}
