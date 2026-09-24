import { RemotePairingSettingsView } from "./RemotePairingSettingsView";
import { useRemotePairingSettingsModel } from "./useRemotePairingSettingsModel";

export function RemotePairingSettings(): JSX.Element {
	return <RemotePairingSettingsView model={useRemotePairingSettingsModel()} />;
}
