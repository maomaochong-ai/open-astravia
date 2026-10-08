import { AgentMessage } from "../conversation-view";

/**
 * A reply in the active session: its work and text, then copy, time, usage and
 * the next-prompt prediction status, then the cards it produced.
 */
export function SessionAgentMessage() {
	return (
		<AgentMessage.Root>
			<AgentMessage.Header />
			<AgentMessage.Fold />
			<div>
				<AgentMessage.Content />
			</div>
			<AgentMessage.StreamingIndicator />
			<AgentMessage.Actions>
				<AgentMessage.ActionBar>
					<AgentMessage.CopyAction />
					<AgentMessage.Time />
					<AgentMessage.TokenUsage />
				</AgentMessage.ActionBar>
				<AgentMessage.PredictingStatus />
			</AgentMessage.Actions>
			<AgentMessage.Cards />
		</AgentMessage.Root>
	);
}
