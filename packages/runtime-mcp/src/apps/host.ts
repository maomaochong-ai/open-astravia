import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type {
	IMcpClient,
	McpAppAttachment,
	McpJsonObject,
	McpRequestOptions,
	McpTool,
	McpToolCallResult,
} from "../protocol/index.js";
import type { McpToolResultContext } from "../tools/mcp-tool-result-policy.js";

export interface McpAppClientLease {
	readonly client?: IMcpClient;
	release(): Promise<void> | void;
}

export interface McpAppExecutionAttachmentRequest {
	readonly client: IMcpClient;
	readonly acquireClient: () => McpAppClientLease;
	readonly serverName: string;
	readonly serverTools: readonly McpTool[];
	readonly autoApproveTools: readonly string[];
	readonly tool: McpTool;
	readonly input: Readonly<Record<string, unknown>>;
	readonly result: McpToolCallResult;
	readonly context: McpToolResultContext;
}

/** Product host for untrusted Apps resources. runtime-mcp never stores HTML or owns UI policy. */
export interface McpAppExecutionHost {
	attach(request: McpAppExecutionAttachmentRequest): Promise<McpAppAttachment | undefined>;
}

export interface McpAppToolCallRequest {
	readonly name: string;
	readonly arguments?: McpJsonObject;
	readonly options?: McpRequestOptions;
}

/** Adds only an opaque host descriptor; raw HTML remains in the product-owned registry. */
export function attachMcpAppDescriptor(projected: RuntimeToolResult, attachment: McpAppAttachment): RuntimeToolResult {
	const details = isRecord(projected.details) ? projected.details : { mcpResult: projected.details };
	const meta = isRecord(details._meta) ? details._meta : {};
	return {
		...projected,
		details: {
			...details,
			_meta: {
				...meta,
				"io.vetta/mcpApp": attachment,
			},
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
