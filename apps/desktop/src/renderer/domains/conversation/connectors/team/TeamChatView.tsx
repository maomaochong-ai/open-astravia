import { DefaultChatView, ChatComposer, ChatError } from "../../components/chat-view/DefaultChatView";
import { MessageList } from "../../components/MessageList";
import { TeamComposerConnector } from "./TeamComposerConnector";
import { TeamMemberRoster } from "./TeamMemberRoster";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";

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
			activity={model.workspace ? { workspace: model.workspace, pluginScenario: model.pluginScenario } : undefined}
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
			<MessageList
				messages={[...model.feedItems]}
				cwd={model.workspace?.cwd}
				isStreaming={isStreaming}
				sessionId={model.feedKey}
				participants={model.members}
				pendingLabel={model.pendingLabel}
				onTeamMemberOpen={onOpenMember}
			/>
			<ChatError>{model.error}</ChatError>
			{model.memberViewId ? null : (
				<ChatComposer>
					<TeamComposerConnector model={model} actions={actions} />
				</ChatComposer>
			)}
		</DefaultChatView>
	);
}
