import { EnvironmentSettingsView } from "./EnvironmentSettingsView";
import { useEnvironmentSettingsModel } from "./useEnvironmentSettingsModel";

export function EnvironmentSettings(): JSX.Element {
	return <EnvironmentSettingsView model={useEnvironmentSettingsModel()} />;
}
