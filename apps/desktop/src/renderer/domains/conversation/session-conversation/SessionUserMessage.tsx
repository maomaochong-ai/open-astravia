import { UserMessage } from "../conversation-view";
import { AnnotationMarker } from "./session-extensions";

/**
 * A user message in the active session: edit, fork, copy and saved annotations
 * under the bubble, sibling branches below, and delete in the context menu.
 * Each command shows only when the feed offers it.
 */
export function SessionUserMessage() {
	return (
		<UserMessage.Root>
			<UserMessage.Actions>
				<UserMessage.ActionBar>
					<UserMessage.EditAction />
					<UserMessage.ForkAction />
					<UserMessage.CopyAction />
					<AnnotationMarker />
				</UserMessage.ActionBar>
				<UserMessage.BranchSwitcher />
			</UserMessage.Actions>
			<UserMessage.DeleteCommand />
		</UserMessage.Root>
	);
}
