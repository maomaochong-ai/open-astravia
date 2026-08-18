import { PermissionsSettingsView } from "./PermissionsSettingsView";
import { usePermissionsSettingsModel } from "./usePermissionsSettingsModel";

export function PermissionsSettings(): JSX.Element {
	const model = usePermissionsSettingsModel();
	return <PermissionsSettingsView model={model} />;
}
