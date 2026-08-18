import { TeamSettingsView } from "./TeamSettingsView";
import { useTeamSettingsModel } from "./useTeamSettingsModel";

export function TeamSettings(): JSX.Element {
	const model = useTeamSettingsModel();
	return <TeamSettingsView model={model} />;
}
