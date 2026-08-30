import type { McpCreateTaskResult, McpInputRequiredResult } from "../protocol/index.js";

/** Error raised when an HTTP MCP server requires interactive authorization. */
export class McpAuthRequiredError extends Error {
	readonly code = "MCP_AUTH_REQUIRED" as const;
	readonly serverName: string;
	readonly serverUrl: string;

	constructor(serverName: string, serverUrl: string, message?: string) {
		super(message ?? `MCP server '${serverName}' requires OAuth authorization`);
		this.name = "McpAuthRequiredError";
		this.serverName = serverName;
		this.serverUrl = serverUrl;
	}
}

/** Modern MCP result that pauses an operation until the host supplies MRTR input. */
export class McpInputRequiredError extends Error {
	readonly code = "MCP_INPUT_REQUIRED" as const;
	readonly method: string;
	readonly result: McpInputRequiredResult;

	constructor(method: string, result: McpInputRequiredResult) {
		super(`MCP request '${method}' requires additional input`);
		this.name = "McpInputRequiredError";
		this.method = method;
		this.result = result;
	}
}

export function isMcpInputRequiredError(error: unknown): error is McpInputRequiredError {
	return error instanceof McpInputRequiredError || getErrorCode(error) === "MCP_INPUT_REQUIRED";
}

/** Modern Tasks result that replaces a synchronous ToolResult. */
export class McpTaskCreatedError extends Error {
	readonly code = "MCP_TASK_CREATED" as const;
	readonly method: string;
	readonly result: McpCreateTaskResult;

	constructor(method: string, result: McpCreateTaskResult) {
		super(`MCP request '${method}' created task '${result.taskId}'`);
		this.name = "McpTaskCreatedError";
		this.method = method;
		this.result = result;
	}
}

export function isMcpTaskCreatedError(error: unknown): error is McpTaskCreatedError {
	return error instanceof McpTaskCreatedError || getErrorCode(error) === "MCP_TASK_CREATED";
}

export function isMcpAuthRequiredError(error: unknown): error is McpAuthRequiredError {
	return error instanceof McpAuthRequiredError || getErrorCode(error) === "MCP_AUTH_REQUIRED";
}

function getErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}
