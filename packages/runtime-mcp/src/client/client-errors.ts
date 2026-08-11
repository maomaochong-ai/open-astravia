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

export function isMcpAuthRequiredError(error: unknown): error is McpAuthRequiredError {
	return error instanceof McpAuthRequiredError || getErrorCode(error) === "MCP_AUTH_REQUIRED";
}

function getErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}
