import { DefaultChatView } from "../../components/chat-view/DefaultChatView";
import { TeamComposerConnector } from "./TeamComposerConnector";
import { TeamMemberRoster } from "./TeamMemberRoster";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";

const TEAM_MESSAGE_CONTEXT = {
	inheritActiveSession: false,
	showRuntimeFooter: false,
	showSuggestions: false,
	userMessageActions: { edit: false, fork: false, delete: false },
} as const;

export interface TeamChatViewProps {
	readonly model: TeamChatViewModel;
	readonly actions: TeamChatActions;
	readonly onOpenMember: (memberId: string) => void;
	readonly onBackToTeam: () => void;
	readonly onOpenSettings: () => void;
}

export function TeamChatView({
	model,
	actions,
	onOpenMember,
	onBackToTeam,
	onOpenSettings,
}: TeamChatViewProps): JSX.Element {
	const isStreaming = model.memberViewId
		? model.feedItems.some((item) => item.kind === "agent" && item.phase === "streaming")
		: model.status === "sending" || model.status === "streaming" || model.status === "cancelling";

	return (
		<DefaultChatView
			messages={[...model.feedItems]}
			isStreaming={isStreaming}
			sessionId={model.feedKey}
			participants={model.members}
			messageContext={TEAM_MESSAGE_CONTEXT}
			pendingLabel={model.pendingLabel}
			onAbort={() => void actions.abort()}
			error={model.error}
			activity={
				model.workspace
					? { workspace: model.workspace, pluginScenario: model.pluginScenario }
					: undefined
			}
			onTeamMemberOpen={onOpenMember}
			subHeader={
				<TeamMemberRoster
					members={model.members}
					leaderMemberId={model.leaderMemberId}
					leaderLabel={model.labels.leaderRoute}
					memberRuntimeIds={model.memberRuntimeIds}
					activeMemberId={model.memberViewId}
					onOpenMember={onOpenMember}
					onBackToTeam={onBackToTeam}
					onOpenSettings={onOpenSettings}
				/>
			}
		>
			{model.memberViewId ? null : <TeamComposerConnector model={model} actions={actions} />}
		</DefaultChatView>
	);
}
