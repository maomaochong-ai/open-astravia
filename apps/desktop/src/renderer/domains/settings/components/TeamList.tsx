import { TeamListView } from "@vetta/theme-ui/settings";
import type { TeamVO } from "@shared/lib/api";
import { SETTINGS_SECTION } from "../registry";
import type { TeamSettingsLabels } from "./useTeamSettingsModel";

export function TeamList({
	teams,
	loading,
	labels,
	onSelect,
}: {
	teams: TeamVO[];
	loading: boolean;
	labels: TeamSettingsLabels;
	onSelect: (id: number) => void;
}): JSX.Element {
	return (
		<TeamListView
			section={SETTINGS_SECTION["team-my-teams"]}
			loading={loading}
			emptyLabel={labels.joinViaCode}
			onSelect={onSelect}
			teams={teams.map((team) => ({
				id: team.id,
				name: team.name,
				roleLabel: roleLabel(team.role, labels),
			}))}
		/>
	);
}

function roleLabel(role: TeamVO["role"], labels: TeamSettingsLabels): string {
	if (role === "owner") return labels.ownerRole;
	if (role === "admin") return labels.adminRole;
	return labels.memberRole;
}
