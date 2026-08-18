import { AppshotSettingsView } from "./AppshotSettingsView";
import { useAppshotSettingsModel } from "./useAppshotSettingsModel";

export function AppshotSettings(): JSX.Element {
	const model = useAppshotSettingsModel();
	return <AppshotSettingsView model={model} />;
}
