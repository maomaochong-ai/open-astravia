import { AgentMessage } from "./agent-message";
import { EventMessage } from "./event-message";
import { UserMessage } from "./user-message";

/**
 * Read-only templates used for a message kind the composition declares no
 * template for: the content and a copy action, without session commands.
 */
export function DefaultUserMessage() {
	return (
		<UserMessage.Root>
			<UserMessage.Actions>
				<UserMessage.ActionBar>
					<UserMessage.CopyAction />
				</UserMessage.ActionBar>
			</UserMessage.Actions>
		</UserMessage.Root>
	);
}

export function DefaultAgentMessage() {
	return (
		<AgentMessage.Root>
			<AgentMessage.Body />
		</AgentMessage.Root>
	);
}

export function DefaultEventMessage() {
	return (
		<EventMessage.Root>
			<EventMessage.Body />
		</EventMessage.Root>
	);
}
