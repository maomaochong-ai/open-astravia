import { DefaultChatView } from "../../components/chat-view/DefaultChatView";
import { TeamComposerConnector } from "./TeamComposerConnector";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";

const TEAM_WORKSPACE_BUILTIN_TABS = ["file", "browser"] as const;
const TEAM_MESSAGE_CONTEXT = {
	inheritActiveSession: false,
	showRuntimeFooter: false,
	showSuggestions: false,
	userMessageActions: { edit: false, fork: false, delete: false },
} as const;

export interface TeamChatViewProps {
	readonly model: TeamChatViewModel;
	readonly actions: TeamChatActions;
}

export function TeamChatView({ model, actions }: TeamChatViewProps): JSX.Element {
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
			onAbort={() => void actions.abort()}
			error={model.error}
			activity={
				model.workspace
					? {
							workspace: model.workspace,
							enablePluginTabs: false,
							enabledBuiltinTabs: TEAM_WORKSPACE_BUILTIN_TABS,
						}
					: undefined
			}
		>
			{model.memberViewId ? null : <TeamComposerConnector model={model} actions={actions} />}
		</DefaultChatView>
	);
}
