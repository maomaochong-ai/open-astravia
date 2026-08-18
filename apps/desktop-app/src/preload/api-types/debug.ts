export interface ToolCallRecord {
	id: string;
	toolName: string;
	toolCallId: string;
	timestamp: string;
	args: unknown;
	result?: unknown;
	isError: boolean;
}

export interface RequestFileInfo {
	filename: string;
	path: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	costTotal: number;
	timestamp: number;
	size: number;
}

export interface DesktopDebugApi {
	parseToolCalls(sessionPath: string): Promise<ToolCallRecord[]>;
	listRequestFiles(projectName: string, sessionId: string): Promise<RequestFileInfo[]>;
	clearDebugDir(): Promise<void>;
}
