import { MotionSelect, SettingRow, SettingSection } from "@vetta-org/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { ModelTransportSettingsModel } from "./useModelTransportSettingsModel";

export function ModelTransportSettingsSection({ model }: { model: ModelTransportSettingsModel }): JSX.Element {
	return (
		<SettingSection
			title={model.labels.title}
			section={SETTINGS_SECTION["models-transport"]}
			description={model.labels.description}
		>
			<SettingRow title={model.labels.rowTitle} description={model.labels.rowDescription} border={false}>
				<MotionSelect
					value={model.transport}
					onValueChange={(value) => void model.actions.setTransport(value as ModelTransportSettingsModel["transport"])}
					options={model.options}
					disabled={model.loading || model.saving}
					triggerClassName="min-w-[180px]"
					aria-label={model.labels.rowTitle}
				/>
			</SettingRow>
		</SettingSection>
	);
}
