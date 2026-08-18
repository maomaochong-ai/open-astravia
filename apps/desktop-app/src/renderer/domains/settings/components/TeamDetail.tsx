import type { TeamDetailVO } from "@shared/lib/api";
import { TeamDetailView } from "@vetta/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { TeamSettingsLabels } from "./useTeamSettingsModel";

export function TeamDetail({
	detail,
	labels,
	onBack,
	onResetCode,
	onRemoveMember,
	onLeave,
}: {
	detail: TeamDetailVO;
	labels: TeamSettingsLabels;
	onBack: () => void;
	onResetCode: () => Promise<void>;
	onRemoveMember: (userId: number) => Promise<void>;
	onLeave: () => Promise<void>;
}): JSX.Element {
	return (
		<TeamDetailView
			detail={detail}
			labels={labels}
			infoSection={SETTINGS_SECTION["team-detail-info"]}
			membersSection={SETTINGS_SECTION["team-members"]}
			onBack={onBack}
			onResetCode={() => void onResetCode()}
			onRemoveMember={(userId) => void onRemoveMember(userId)}
			onLeave={() => void onLeave()}
		/>
	);
}
