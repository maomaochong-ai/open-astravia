import { ActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { InputBar } from "@domains/chat/components/InputBar";
import type {
	AgentTeamDocument,
	TeamDefinition,
	TeamSessionDocument,
} from "@vetta/agent-team";
import { TeamComposer } from "./TeamComposer";
import { TeamMessageFeed } from "./TeamMessageFeed";

export interface TeamChatViewProps {
	readonly document?: AgentTeamDocument;
	readonly team?: TeamDefinition;
	readonly session?: TeamSessionDocument;
	readonly text: string;
	readonly pendingText?: string;
	readonly streamingByMember: Readonly<Record<string, string>>;
	readonly targetMemberIds: readonly string[];
	readonly sending: boolean;
	readonly error?: string;
	readonly onTextChange: (text: string) => void;
	readonly onTargetMemberIdsChange: (memberIds: readonly string[]) => void;
	readonly onSend: (overrideText?: string) => void;
}

export function TeamChatView(props: TeamChatViewProps): JSX.Element {
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 bg-background">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<TeamMessageFeed
					document={props.document}
					team={props.team}
					session={props.session}
					pendingText={props.pendingText}
					streamingByMember={props.streamingByMember}
					sending={props.sending}
				/>
				<InputBar
					cwdOverride={props.session?.cwd}
					hasSessionOverride={Boolean(props.session)}
					isStreamingOverride={props.sending}
					header={
						<TeamComposer
							document={props.document}
							team={props.team}
							text={props.text}
							selectedMemberIds={props.targetMemberIds}
							onTextChange={props.onTextChange}
							onSelectedMemberIdsChange={props.onTargetMemberIdsChange}
						/>
					}
					onSend={async (overrideText) => props.onSend(overrideText)}
					onAbort={async () => {
						if (props.session) await window.vetta.agentTeams.abort(props.session.id);
					}}
				/>
			</div>
			<ActivityPanel cwd={props.session?.cwd ?? null} />
		</div>
	);
}
