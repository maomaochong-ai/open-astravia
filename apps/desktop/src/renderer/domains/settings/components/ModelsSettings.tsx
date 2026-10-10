import { ModelsSettingsView } from "./ModelsSettingsView";
import { useModelTransportSettingsModel } from "./useModelTransportSettingsModel";
import { useModelsSettingsModel } from "./useModelsSettingsModel";
export { InputField, SelectField } from "./SettingsFormFields";

export function ModelsSettings(): JSX.Element {
	const model = useModelsSettingsModel();
	const transport = useModelTransportSettingsModel();
	return <ModelsSettingsView model={model} transport={transport} />;
}
