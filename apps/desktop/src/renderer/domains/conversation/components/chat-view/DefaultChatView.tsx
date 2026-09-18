import { ActivityPanel, CurrentScenarioActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { cn } from "@shared/lib/utils";
import { PerfSendProfiler } from "@shared/lib/perf-send";
import type { ChatConversationItem } from "@shared/store/atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { ActivityTabId } from "@domains/activity-panel/registry/types";
import type { ConversationScenario } from "@vetta-org/plugin-sdk";
import { memo, type ReactNode } from "react";
import { ChatExportHost } from "../ChatExportHost";

export const EMPTY_CHAT_MESSAGES: ChatConversationItem[] = [];

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

function sameStringList(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
	if (left === right) return true;
	if (!left || !right || left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

function isSameWorkspace(left: ActivityWorkspace, right: ActivityWorkspace): boolean {
	return left.id === right.id && left.cwd === right.cwd && sameStringList(left.runtimeIds, right.runtimeIds);
}

function isSameActivity(
	left: DefaultChatViewProps["activity"],
	right: DefaultChatViewProps["activity"],
): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	return (
		left.enablePluginTabs === right.enablePluginTabs &&
		left.pluginScenario === right.pluginScenario &&
		sameStringList(left.enabledBuiltinTabs, right.enabledBuiltinTabs)
	);
}

const FrozenActivityColumn = memo(
	function FrozenActivityColumn({
		workspace,
		activity,
	}: {
		workspace: ActivityWorkspace;
		activity?: DefaultChatViewProps["activity"];
	}) {
		return activity ? (
			<ActivityPanel
				workspace={workspace}
				enablePluginTabs={activity.enablePluginTabs}
				enabledBuiltinTabs={activity.enabledBuiltinTabs}
				pluginScenario={activity.pluginScenario}
			/>
		) : (
			<CurrentScenarioActivityPanel workspace={workspace} />
		);
	},
	(previous, next) => isSameWorkspace(previous.workspace, next.workspace) && isSameActivity(previous.activity, next.activity),
);

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
					<FrozenActivityColumn workspace={workspace} activity={activity} />
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
