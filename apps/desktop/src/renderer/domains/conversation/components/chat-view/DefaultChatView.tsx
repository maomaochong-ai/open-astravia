import { ActivityPanel, ConversationActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { cn } from "@shared/lib/utils";
import { PerfSendProfiler } from "@shared/lib/perf-send";
import type { ConversationParticipantViewModel } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { ActivityTabId } from "@domains/activity-panel/registry/types";
import type { ReactNode } from "react";
import { ChatExportHost } from "../ChatExportHost";
import { MessageList } from "../MessageList";
import type { MessageListProps } from "../message-list/types";

export interface DefaultChatViewProps {
	readonly children: ReactNode;
	readonly messages: ChatConversationItem[];
	readonly isStreaming: boolean;
	readonly sessionId: string | null;
	readonly onAbort?: () => void;
	readonly onSend?: (overrideText?: string) => Promise<void>;
	readonly participants?: readonly ConversationParticipantViewModel[];
	readonly messageContext?: MessageListProps["context"];
	readonly pendingLabel?: string;
	readonly rootClassName?: string;
	readonly error?: string;
	readonly exportState?: {
		readonly title: string;
		readonly onFinished: () => void;
	};
	readonly activity?: {
		readonly workspace: ActivityWorkspace;
		readonly enablePluginTabs?: boolean;
		readonly enabledBuiltinTabs?: readonly ActivityTabId[];
	};
}

export function DefaultChatView({
	children,
	messages,
	isStreaming,
	sessionId,
	onAbort,
	onSend,
	participants,
	messageContext,
	pendingLabel,
	rootClassName,
	error,
	exportState,
	activity,
}: DefaultChatViewProps): JSX.Element {
	return (
		<PerfSendProfiler id="ChatView(total)">
			<div className={cn("flex h-full min-w-0 flex-1 flex-col bg-background", rootClassName)}>
				{exportState ? (
					<ChatExportHost messages={messages} title={exportState.title} onFinished={exportState.onFinished} />
				) : null}
				<div className="flex min-h-0 flex-1 gap-2 overflow-visible">
					<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
						<PerfSendProfiler id="MessageList">
							<MessageList
								messages={messages}
								isStreaming={isStreaming}
								sessionId={sessionId}
								onSend={onSend}
								onAbort={onAbort}
								participants={participants}
								context={messageContext}
								pendingLabel={pendingLabel}
							/>
						</PerfSendProfiler>
						{error ? (
							<div
								className="mx-auto mb-2 w-full max-w-2xl rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
								role="alert"
							>
								{error}
							</div>
						) : null}
						<div className="relative shrink-0">
							<PerfSendProfiler id="InputBar">
								{children}
							</PerfSendProfiler>
						</div>
					</div>
					{activity ? (
						<ActivityPanel
							workspace={activity.workspace}
							enablePluginTabs={activity.enablePluginTabs}
							enabledBuiltinTabs={activity.enabledBuiltinTabs}
						/>
					) : (
						<ConversationActivityPanel />
					)}
				</div>
			</div>
		</PerfSendProfiler>
	);
}
