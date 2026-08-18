import { GeneralSettingsView } from "./GeneralSettingsView";
import { useGeneralSettingsModel } from "./useGeneralSettingsModel";

export function GeneralSettings(): JSX.Element {
	return <GeneralSettingsView model={useGeneralSettingsModel()} />;
}
