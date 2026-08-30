export type DesktopMcpTaskStatus = "working" | "input_required" | "completed" | "failed" | "cancelled";

export interface DesktopMcpTask {
	readonly id: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly serverName: string;
	readonly toolName: string;
	readonly status: DesktopMcpTaskStatus;
	readonly statusMessage?: string;
	readonly createdAt: string;
	readonly lastUpdatedAt: string;
	readonly recovered?: boolean;
}

export interface DesktopMcpTasksChangedEvent {
	readonly tasks: readonly DesktopMcpTask[];
}
