import { ActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { cn } from "@shared/lib/utils";
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
}: DefaultChatViewProps): JSX.Element {
	return (
		<div className={cn("flex h-full min-w-0 flex-1 flex-col bg-background", model.rootClassName)}>
			{model.exporting && (
				<ChatExportHost messages={model.messages} title={model.exportTitle} onFinished={actions.finishExport} />
			)}
			<div className="flex min-h-0 flex-1 gap-2 overflow-visible">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					<MessageList
						messages={model.messages}
						isStreaming={model.isStreaming}
						sessionId={model.sessionId}
						onSend={onSend}
						onAbort={onAbort}
					/>
					{/* Drop target lives on the input card inside InputBar (not outer padding). */}
					<div className="relative shrink-0">
						<InputBar onSend={onSend} onAbort={onAbort} onSendQueued={onSendQueued} />
					</div>
				</div>
				<ActivityPanel />
			</div>
		</div>
	);
}
