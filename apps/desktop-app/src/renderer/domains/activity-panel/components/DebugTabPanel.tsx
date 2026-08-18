import { DebugTabPanelView } from "@vetta/theme-ui/activity";
import { useDebugTabPanelModel } from "../hooks/useDebugTabPanelModel";
import { ToolCallsSubTab } from "./ToolCallsSubTab";
import { RequestHistorySubTab } from "./RequestHistorySubTab";

export function DebugTabPanel({ cwd }: { cwd: string }): JSX.Element {
	const model = useDebugTabPanelModel();

	return (
		<DebugTabPanelView
			subTab={model.subTab}
			onSubTabChange={model.setSubTab}
			toolCallsLabel={model.toolCallsLabel}
			requestHistoryLabel={model.requestHistoryLabel}
			toolCalls={<ToolCallsSubTab cwd={cwd} />}
			requestHistory={<RequestHistorySubTab cwd={cwd} />}
		/>
	);
}
