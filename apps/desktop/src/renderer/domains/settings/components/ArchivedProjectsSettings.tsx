import { ArchivedProjectsSettingsView } from "./ArchivedProjectsSettingsView";
import { useArchivedProjectsSettingsModel } from "./useArchivedProjectsSettingsModel";

export function ArchivedProjectsSettings(): JSX.Element {
	return <ArchivedProjectsSettingsView model={useArchivedProjectsSettingsModel()} />;
}
