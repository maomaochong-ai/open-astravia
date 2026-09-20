import { SshHostsSettingsView } from "./SshHostsSettingsView";
import { useSshHostsSettingsModel } from "./useSshHostsSettingsModel";

export function SshHostsSettings(): JSX.Element {
	const model = useSshHostsSettingsModel();
	return <SshHostsSettingsView model={model} />;
}
