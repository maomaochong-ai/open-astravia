import { PerfSessionSwitchProfiler } from "@shared/lib/perf-session-switch-profiler";
import { useMessageListModel } from "../hooks/useMessageListModel";
import { useProgressiveMessageViewport } from "../hooks/useProgressiveMessageViewport";
import { MessageListView, ExportMessageList } from "./message-list/MessageListView";
import type { MessageListProps } from "./message-list/types";

export { ExportMessageList };

export function MessageList(props: MessageListProps): JSX.Element {
	const model = useMessageListModel(props);
	const viewportPhase = useProgressiveMessageViewport(props.sessionId ?? null, props.messages.length > 0);
	return (
		<PerfSessionSwitchProfiler id={`MessageList:${viewportPhase}-viewport`}>
			<MessageListView
				model={model}
				viewportPhase={viewportPhase}
				onSend={props.onSend}
				onAbort={props.onAbort}
				sessionId={props.sessionId}
				pendingLabel={props.pendingLabel}
			/>
		</PerfSessionSwitchProfiler>
	);
}
