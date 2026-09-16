import { ActivityPanel, CurrentScenarioActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { cn } from "@shared/lib/utils";
import { PerfSendProfiler } from "@shared/lib/perf-send";
import type { ChatConversationItem } from "@shared/store/atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { ActivityTabId } from "@domains/activity-panel/registry/types";
import type { ConversationScenario } from "@vetta-org/plugin-sdk";
import type { ReactNode } from "react";
import { ChatExportHost } from "../ChatExportHost";

export interface DefaultChatViewProps {
	readonly children: ReactNode;
	/** 消息流上方的常驻条（Team 的成员胶囊条就住在这里）。 */
	readonly subHeader?: ReactNode;
	readonly messages: ChatConversationItem[];
	readonly workspace: ActivityWorkspace;
	readonly rootClassName?: string;
	readonly exportState?: {
		readonly title: string;
		readonly onFinished: () => void;
	};
	readonly activity?: {
		readonly enablePluginTabs?: boolean;
		readonly enabledBuiltinTabs?: readonly ActivityTabId[];
		/** Hosts that do not drive the global scenario atom (Team) pass their own scenario. */
		readonly pluginScenario?: ConversationScenario;
	};
}

export function DefaultChatView({
	children,
	subHeader,
	messages,
	workspace,
	rootClassName,
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
						{subHeader}
						{children}
					</div>
					{activity ? (
						<ActivityPanel
							workspace={workspace}
							enablePluginTabs={activity.enablePluginTabs}
							enabledBuiltinTabs={activity.enabledBuiltinTabs}
							pluginScenario={activity.pluginScenario}
						/>
					) : (
						<CurrentScenarioActivityPanel workspace={workspace} />
					)}
				</div>
			</div>
		</PerfSendProfiler>
	);
}

export function ChatComposer({ children }: { children: ReactNode }) {
	return (
		<div className="relative shrink-0">
			<PerfSendProfiler id="InputBar">{children}</PerfSendProfiler>
		</div>
	);
}

export function ChatError({ children }: { children?: ReactNode }) {
	return children ? (
		<div
			className="mx-auto mb-2 w-full max-w-2xl rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
			role="alert"
		>
			{children}
		</div>
	) : null;
}
