import { ImBridgeSettingsView } from "./ImBridgeSettingsView";
import { useImBridgeSettingsModel } from "./useImBridgeSettingsModel";

export function ImBridgeSettings(): JSX.Element {
	const model = useImBridgeSettingsModel();
	return <ImBridgeSettingsView model={model} />;
}
