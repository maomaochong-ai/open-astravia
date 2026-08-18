import { ModelsSettingsView } from "./ModelsSettingsView";
import { useModelsSettingsModel } from "./useModelsSettingsModel";
export { InputField, SelectField } from "./SettingsFormFields";

export function ModelsSettings(): JSX.Element {
	const model = useModelsSettingsModel();
	return <ModelsSettingsView model={model} />;
}
