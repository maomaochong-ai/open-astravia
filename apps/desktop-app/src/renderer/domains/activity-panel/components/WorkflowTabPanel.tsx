import { MessageList } from "@domains/chat/components/MessageList";
import { WorkflowTabPanelView } from "@vetta/theme-ui/activity";
import { useWorkflowTabPanelModel } from "../hooks/useWorkflowTabPanelModel";

/**
 * Workflow activity tab (ADR-0044): switcher + read-only 1:1 MessageList of
 * the selected workflow child session.
 */
export function WorkflowTabPanel(): JSX.Element {
	const model = useWorkflowTabPanelModel();
	return (
		<WorkflowTabPanelView
			items={model.items}
			emptyLabel={model.emptyLabel}
			stopLabel={model.stopLabel}
			noTranscriptLabel={model.noTranscriptLabel}
			hasTranscript={model.messages.length > 0}
			messageList={
				<MessageList
					messages={model.messages}
					isStreaming={model.selected?.status === "running"}
					sessionId={null}
				/>
			}
			onSelect={model.onSelect}
			onStop={model.onStop}
		/>
	);
}
