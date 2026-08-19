import { ActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { cn } from "@shared/lib/utils";
import { PerfSendProfiler } from "@shared/lib/perf-send";
import { ChatExportHost } from "../ChatExportHost";
import { InputBar } from "../InputBar";
import { MessageList } from "../MessageList";
import type { ChatViewActions, ChatViewModel, ChatViewProps } from "./types";

interface DefaultChatViewProps extends ChatViewProps {
	actions: ChatViewActions;
	model: ChatViewModel;
}

export function DefaultChatView({
	actions,
	model,
	onAbort,
	onSend,
	onSendQueued,
	cwdOverride,
	sessionPendingLabel,
}: DefaultChatViewProps): JSX.Element {
	return (
		<PerfSendProfiler id="ChatView(total)">
		<div className={cn("flex h-full min-w-0 flex-1 flex-col bg-background", model.rootClassName)}>
			{model.exporting && (
				<ChatExportHost messages={model.messages} title={model.exportTitle} onFinished={actions.finishExport} />
			)}
			<div className="flex min-h-0 flex-1 gap-2 overflow-visible">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					<PerfSendProfiler id="MessageList">
						<MessageList
							messages={model.messages}
							isStreaming={model.isStreaming}
							sessionId={model.sessionId}
							pendingLabel={sessionPendingLabel}
							onSend={onSend}
							onAbort={onAbort}
						/>
					</PerfSendProfiler>
					{/* Drop target lives on the input card inside InputBar (not outer padding). */}
					<div className="relative shrink-0">
						<PerfSendProfiler id="InputBar">
							<InputBar
								onSend={onSend}
								onAbort={onAbort}
								onSendQueued={onSendQueued}
								cwdOverride={cwdOverride}
								sendDisabled={sessionPendingLabel !== undefined}
							/>
						</PerfSendProfiler>
					</div>
				</div>
				<ActivityPanel />
			</div>
		</div>
		</PerfSendProfiler>
	);
}
