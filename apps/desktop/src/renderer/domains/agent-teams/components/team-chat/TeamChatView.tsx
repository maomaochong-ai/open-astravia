import { ActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
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
	readonly targetMemberIds: readonly string[];
	readonly sending: boolean;
	readonly error?: string;
	readonly onTextChange: (text: string) => void;
	readonly onTargetMemberIdsChange: (memberIds: readonly string[]) => void;
	readonly onSend: () => void;
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
					sending={props.sending}
				/>
				<TeamComposer
					team={props.team}
					text={props.text}
					selectedMemberIds={props.targetMemberIds}
					sending={props.sending}
					disabled={!props.session}
					error={props.error}
					onTextChange={props.onTextChange}
					onSelectedMemberIdsChange={props.onTargetMemberIdsChange}
					onSend={props.onSend}
				/>
			</div>
			<ActivityPanel cwd={props.session?.cwd ?? null} />
		</div>
	);
}
