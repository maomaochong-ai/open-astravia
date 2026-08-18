import { PermissionsSettingsView as ThemePermissionsSettingsView } from "@vetta/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { PermissionsSettingsModel } from "./usePermissionsSettingsModel";

export function PermissionsSettingsView({ model }: { model: PermissionsSettingsModel }): JSX.Element {
	return (
		<ThemePermissionsSettingsView
			error={model.error}
			labels={model.labels}
			section={SETTINGS_SECTION["permissions-system"]}
			onOpen={(id) => void model.actions.open(id as Parameters<typeof model.actions.open>[0])}
			items={model.items.map((item) => ({
				id: item.kind,
				title: item.title,
				description: item.description,
				hideStatus: item.hideStatus,
				status: model.snapshot ? model.snapshot[item.field] : "unknown",
			}))}
		/>
	);
}
