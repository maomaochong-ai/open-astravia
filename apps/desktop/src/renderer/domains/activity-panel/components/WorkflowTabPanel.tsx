import { MessageList } from "@domains/conversation/components/MessageList";
import { WorkflowTabPanelView } from "@vetta-org/theme-ui/activity";
import { useWorkflowTabPanelModel } from "../hooks/useWorkflowTabPanelModel";
import { useActivityWorkspace } from "../registry/context";

/**
 * Workflow activity tab (ADR-0044): switcher + read-only 1:1 MessageList of
 * the selected workflow child session.
 */
export function WorkflowTabPanel(): JSX.Element {
	const model = useWorkflowTabPanelModel();
	const workspace = useActivityWorkspace();
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
					workspace={workspace}
					isStreaming={model.selected?.status === "running"}
					sessionId={model.selected?.sessionFile ?? null}
				/>
			}
			onSelect={model.onSelect}
			onStop={model.onStop}
		/>
	);
}
