import { PluginsSettingsView } from "./PluginsSettingsView";
import { usePluginsSettingsModel } from "./usePluginsSettingsModel";

export function PluginsSettings(): JSX.Element {
	const model = usePluginsSettingsModel();
	return <PluginsSettingsView model={model} />;
}
