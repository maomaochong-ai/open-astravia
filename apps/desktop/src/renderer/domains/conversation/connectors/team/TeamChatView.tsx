import { DefaultChatView, ChatComposer } from "../../components/chat-view/DefaultChatView";
import { MessageList } from "../../components/MessageList";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import { memo, useMemo } from "react";
import { TeamComposerConnector } from "./TeamComposerConnector";
import { TeamMemberRoster } from "./TeamMemberRoster";
import type { TeamChatActions, TeamChatViewModel, TeamComposerViewModel } from "./teamChatModel";

export interface TeamChatViewProps {
	readonly model: TeamChatViewModel;
	readonly actions: TeamChatActions;
	readonly onOpenMember: (memberId: string) => void;
	readonly onBackToTeam: () => void;
	readonly onOpenSettings: () => void;
}

const TeamTimelinePane = memo(function TeamTimelinePane({
	messages,
	workspace,
	isStreaming,
	feedKey,
	members,
	pendingLabel,
	onOpenMember,
}: {
	readonly messages: TeamChatViewModel["feedItems"];
	readonly workspace: ActivityWorkspace;
	readonly isStreaming: boolean;
	readonly feedKey: string;
	readonly members: TeamChatViewModel["members"];
	readonly pendingLabel?: string;
	readonly onOpenMember: (memberId: string) => void;
}): JSX.Element {
	return (
		<MessageList
			messages={messages}
			workspace={workspace}
			isStreaming={isStreaming}
			sessionId={feedKey}
			participants={members}
			pendingLabel={pendingLabel}
			onTeamMemberOpen={onOpenMember}
		/>
	);
});

const TeamRoster = memo(function TeamRoster({
	model,
	onOpenMember,
	onBackToTeam,
	onOpenSettings,
}: Pick<TeamChatViewProps, "model" | "onOpenMember" | "onBackToTeam" | "onOpenSettings">): JSX.Element {
	return (
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
	);
}, (previous, next) =>
	previous.model.members === next.model.members &&
	previous.model.leaderMemberId === next.model.leaderMemberId &&
	previous.model.labels.leaderRoute === next.model.labels.leaderRoute &&
	previous.model.memberRuntimeIds === next.model.memberRuntimeIds &&
	previous.model.memberViewId === next.model.memberViewId &&
	previous.onOpenMember === next.onOpenMember &&
	previous.onBackToTeam === next.onBackToTeam &&
	previous.onOpenSettings === next.onOpenSettings,
);

const TeamComposer = memo(function TeamComposer({
	model,
	actions,
}: {
	readonly model: TeamComposerViewModel;
	readonly actions: TeamChatActions;
}): JSX.Element {
	return <TeamComposerConnector model={model} actions={actions} />;
});

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
	const composerModel = useMemo<TeamComposerViewModel>(
		() => ({
			activeSessionId: model.activeSessionId,
			attachments: model.attachments,
			canSend: model.canSend,
			compactingByRuntime: model.compactingByRuntime,
			contextUsage: model.contextUsage,
			contextUsagesByRuntime: model.contextUsagesByRuntime,
			draft: model.draft,
			draftMemberMentions: model.draftMemberMentions,
			editorEnabled: model.editorEnabled,
			executionMode: model.executionMode,
			history: model.history,
			isCompacting: model.isCompacting,
			labels: model.labels,
			leaderMemberId: model.leaderMemberId,
			memberRuntimeIds: model.memberRuntimeIds,
			members: model.members,
			modelKey: model.modelKey,
			reasoning: model.reasoning,
			runtimeSessionIds: model.runtimeSessionIds,
			status: model.status,
			workspace,
		}),
		[
			model.activeSessionId,
			model.attachments,
			model.canSend,
			model.compactingByRuntime,
			model.contextUsage,
			model.contextUsagesByRuntime,
			model.draft,
			model.draftMemberMentions,
			model.editorEnabled,
			model.executionMode,
			model.history,
			model.isCompacting,
			model.labels,
			model.leaderMemberId,
			model.memberRuntimeIds,
			model.members,
			model.modelKey,
			model.reasoning,
			model.runtimeSessionIds,
			model.status,
			workspace,
		],
	);
	const isStreaming = model.memberViewId
		? model.feedItems.some((item) => item.kind === "agent" && item.phase === "streaming")
		: model.status === "sending" || model.status === "streaming" || model.status === "cancelling";

	return (
		<DefaultChatView
			messages={model.feedItems}
			workspace={workspace}
			activity={activity}
			subHeader={
				<TeamRoster
					model={model}
					onOpenMember={onOpenMember}
					onBackToTeam={onBackToTeam}
					onOpenSettings={onOpenSettings}
				/>
		}
		>
			<TeamTimelinePane
				messages={model.feedItems}
				workspace={workspace}
				isStreaming={isStreaming}
				feedKey={model.feedKey}
				members={model.members}
				pendingLabel={model.pendingLabel}
				onOpenMember={onOpenMember}
			/>
			{model.memberViewId ? null : (
				<ChatComposer>
					<TeamComposer model={composerModel} actions={actions} />
				</ChatComposer>
			)}
		</DefaultChatView>
	);
}
