import {
	CreateTeamDialogView,
	JoinTeamDialogView,
} from "@vetta/theme-ui/settings";
import type { TeamSettingsLabels } from "./useTeamSettingsModel";

export function CreateTeamDialog({
	open,
	labels,
	onOpenChange,
	onCreate,
}: {
	open: boolean;
	labels: TeamSettingsLabels;
	onOpenChange: (open: boolean) => void;
	onCreate: (name: string) => Promise<void>;
}): JSX.Element {
	return (
		<CreateTeamDialogView
			open={open}
			labels={labels}
			onOpenChange={onOpenChange}
			onCreate={onCreate}
		/>
	);
}

export function JoinTeamDialog({
	open,
	labels,
	onOpenChange,
	onJoin,
}: {
	open: boolean;
	labels: TeamSettingsLabels;
	onOpenChange: (open: boolean) => void;
	onJoin: (code: string) => Promise<void>;
}): JSX.Element {
	return (
		<JoinTeamDialogView open={open} labels={labels} onOpenChange={onOpenChange} onJoin={onJoin} />
	);
}
