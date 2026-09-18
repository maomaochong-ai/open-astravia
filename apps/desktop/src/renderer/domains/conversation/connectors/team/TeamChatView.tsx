import { DefaultChatView, ChatComposer } from "../../components/chat-view/DefaultChatView";
import { MessageList } from "../../components/MessageList";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { ChatConversationItem } from "@shared/store/atoms";
import { useMemo } from "react";
import { TeamComposerConnector } from "./TeamComposerConnector";
import { TeamMemberRoster } from "./TeamMemberRoster";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";

const EMPTY_TEAM_CHAT_MESSAGES: ChatConversationItem[] = [];

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
	const workspace = useMemo(
		() => model.workspace ?? createActivityWorkspace(`agent-team:${model.feedKey}`, null),
		[model.feedKey, model.workspace],
	);
	const activity = useMemo(() => ({ pluginScenario: model.pluginScenario }), [model.pluginScenario]);
	const isStreaming = model.memberViewId
		? model.feedItems.some((item) => item.kind === "agent" && item.phase === "streaming")
		: model.status === "sending" || model.status === "streaming" || model.status === "cancelling";

	return (
		<DefaultChatView
			messages={EMPTY_TEAM_CHAT_MESSAGES}
			workspace={workspace}
			activity={activity}
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
				workspace={workspace}
				isStreaming={isStreaming}
				sessionId={model.feedKey}
				participants={model.members}
				pendingLabel={model.pendingLabel}
				onTeamMemberOpen={onOpenMember}
			/>
			{model.memberViewId ? null : (
				<ChatComposer>
					<TeamComposerConnector model={model} actions={actions} />
				</ChatComposer>
			)}
		</DefaultChatView>
	);
}
