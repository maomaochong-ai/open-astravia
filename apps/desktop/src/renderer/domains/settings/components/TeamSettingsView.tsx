import { TeamSettingsView as ThemeTeamSettingsView } from "@vetta/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import { CreateTeamDialog, JoinTeamDialog } from "./TeamDialogs";
import { TeamDetail } from "./TeamDetail";
import { TeamList } from "./TeamList";
import type { TeamSettingsModel } from "./useTeamSettingsModel";

export function TeamSettingsView({ model }: { model: TeamSettingsModel }): JSX.Element {
	return (
		<ThemeTeamSettingsView
			tokenPresent={Boolean(model.token)}
			loginRequiredLabel={model.labels.loginRequired}
			description={model.labels.description}
			section={SETTINGS_SECTION["team-management"]}
			onJoinOpen={() => model.setJoinOpen(true)}
			onCreateOpen={() => model.setCreateOpen(true)}
			body={
				model.selectedTeam ? (
					<TeamDetail
						detail={model.selectedTeam}
						labels={model.labels}
						onBack={model.onBack}
						onResetCode={model.onResetInviteCode}
						onRemoveMember={model.onRemoveMember}
						onLeave={model.onLeaveTeam}
					/>
				) : (
					<TeamList
						teams={model.teams}
						loading={model.loading}
						labels={model.labels}
						onSelect={model.onSelectTeam}
					/>
				)
			}
			dialogs={
				<>
					<CreateTeamDialog
						open={model.createOpen}
						labels={model.labels}
						onOpenChange={model.setCreateOpen}
						onCreate={model.onCreateTeam}
					/>
					<JoinTeamDialog
						open={model.joinOpen}
						labels={model.labels}
						onOpenChange={model.setJoinOpen}
						onJoin={model.onJoinTeam}
					/>
				</>
			}
		/>
	);
}
