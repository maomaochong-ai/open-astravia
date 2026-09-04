import { ExtensionsSettingsView } from "./ExtensionsSettingsView";
import { useExtensionsSettingsModel } from "./useExtensionsSettingsModel";

export function ExtensionsSettings(): JSX.Element {
	return <ExtensionsSettingsView model={useExtensionsSettingsModel()} />;
}
