import { ArchivedProjectsSettingsView as ThemeArchivedProjectsSettingsView } from "@vetta/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { ArchivedProjectsSettingsModel } from "./useArchivedProjectsSettingsModel";

export interface ArchivedProjectsSettingsViewProps {
	model: ArchivedProjectsSettingsModel;
}

export function ArchivedProjectsSettingsView({ model }: ArchivedProjectsSettingsViewProps): JSX.Element {
	return (
		<ThemeArchivedProjectsSettingsView
			labels={model.labels}
			projects={model.projects}
			section={SETTINGS_SECTION["archived-list"]}
			onUnarchive={(path) => void model.actions.unarchive(path)}
			onDelete={(path) => model.actions.delete(path)}
		/>
	);
}
