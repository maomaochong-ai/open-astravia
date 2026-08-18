import { AppearanceSettingsView } from "./AppearanceSettingsView";
import { useAppearanceSettingsModel } from "./useAppearanceSettingsModel";

export function AppearanceSettings(): JSX.Element {
	const model = useAppearanceSettingsModel();
	return <AppearanceSettingsView model={model} />;
}
