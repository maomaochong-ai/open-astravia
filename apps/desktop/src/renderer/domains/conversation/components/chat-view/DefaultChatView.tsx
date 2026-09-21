import { ActivityPanel, CurrentScenarioActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { BottomPanelHost } from "@domains/bottom-panel/components/BottomPanelHost";
import { cn } from "@shared/lib/utils";
import { PerfSendProfiler } from "@shared/lib/perf-send";
import type { ChatConversationItem } from "@shared/store/atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { ActivityTabId } from "@domains/activity-panel/registry/types";
import type { ConversationScenario } from "@vetta-org/plugin-sdk";
import { memo, type ReactNode } from "react";
import { ChatExportHost } from "../ChatExportHost";

export interface DefaultChatViewProps {
	readonly children: ReactNode;
	/** 消息流上方的常驻条（Team 的成员胶囊条就住在这里）。 */
	readonly subHeader?: ReactNode;
	readonly messages: readonly ChatConversationItem[];
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

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return left === right || (left.length === right.length && left.every((id, index) => id === right[index]));
}

function sameOptionalIds(left?: readonly string[], right?: readonly string[]): boolean {
	if (!left || !right) return left === right;
	return sameIds(left, right);
}

function sameActivity(
	left: DefaultChatViewProps["activity"],
	right: DefaultChatViewProps["activity"],
): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	return left.enablePluginTabs === right.enablePluginTabs &&
		left.pluginScenario === right.pluginScenario &&
		sameOptionalIds(left.enabledBuiltinTabs, right.enabledBuiltinTabs);
}

const ActivityColumn = memo(
	function ActivityColumn({ workspace, activity }: Pick<DefaultChatViewProps, "workspace" | "activity">) {
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
	(previous, next) =>
		previous.workspace.id === next.workspace.id &&
		previous.workspace.cwd === next.workspace.cwd &&
		sameIds(previous.workspace.runtimeIds, next.workspace.runtimeIds) &&
		sameActivity(previous.activity, next.activity),
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
					{/*
					 * 用 clip + 8px clip-margin 代替 overflow-hidden：底部面板要贴到窗口下沿、
					 * 右侧要顶到活动面板，得越过 AppFrame 的 p-2 和这一行的 gap-2（各 8px），
					 * 而消息流本身仍然需要被裁住。
					 */}
					<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip [overflow-clip-margin:8px]">
						{subHeader}
						{children}
						{/*
						 * 底部面板住在消息列内部，宽度跟着消息列走、不伸到活动面板下方：
						 * 活动面板是与消息流并列的一列，横穿它的底边会把两列看成一块。
						 */}
						<BottomPanelHost />
					</div>
					<ActivityColumn workspace={workspace} activity={activity} />
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
