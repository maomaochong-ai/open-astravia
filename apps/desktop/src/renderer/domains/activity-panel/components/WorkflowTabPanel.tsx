import { TranscriptConversation } from "@domains/conversation/components/TranscriptConversation";
import { WorkflowTabPanelView } from "@vetta-org/theme-ui/activity";
import { useWorkflowTabPanelModel } from "../hooks/useWorkflowTabPanelModel";
import { useActivityWorkspace } from "../registry/context";

/**
 * Workflow activity tab (ADR-0044): switcher + read-only 1:1 transcript of
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
				<TranscriptConversation
					feedKey={model.selected?.sessionFile ?? null}
					messages={model.messages}
					workspace={workspace}
					isStreaming={model.selected?.status === "running"}
				/>
			}
			onSelect={model.onSelect}
			onStop={model.onStop}
		/>
	);
}
