import { type TLiteralValue, type TSchema, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition, RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { IMcpClient, McpJsonObject, McpTool } from "../protocol/index.js";
import {
	type McpToolResultContext,
	type McpToolResultPolicy,
	PRESERVE_MCP_TOOL_RESULT_POLICY,
} from "./mcp-tool-result-policy.js";

/** Preserve the legacy MCP JSON Schema projection used by Coding Agent tools. */
export function convertMcpJsonSchemaToTypeBox(jsonSchema: unknown): TSchema {
	if (!jsonSchema) return Type.Object({});
	const schema = asRecord(jsonSchema);
	if (!schema) return Type.Any();

	if (schema.type === "object") {
		const properties: Record<string, TSchema> = {};
		const sourceProperties = asRecord(schema.properties);
		if (sourceProperties) {
			for (const [key, propertySchema] of Object.entries(sourceProperties)) {
				properties[key] = convertMcpJsonSchemaToTypeBox(propertySchema);
			}
		}
		const required = Array.isArray(schema.required)
			? schema.required.filter((value): value is string => typeof value === "string")
			: [];
		const objectSchema = Type.Object(properties);
		// Compatibility: the original adapter marked properties optional only after
		// Type.Object materialized `required`, so its serialized required list remains unchanged.
		for (const key of Object.keys(properties)) {
			const property = objectSchema.properties[key];
			if (!required.includes(key) && property) objectSchema.properties[key] = Type.Optional(property);
		}
		return objectSchema;
	}

	if (schema.type === "array") {
		const items = schema.items ? convertMcpJsonSchemaToTypeBox(schema.items) : Type.Any();
		return Type.Array(items);
	}
	if (schema.type === "string") {
		if (Array.isArray(schema.enum)) {
			return Type.Union(schema.enum.filter(isLiteralValue).map((value) => Type.Literal(value)));
		}
		return Type.String();
	}
	if (schema.type === "number") return Type.Number();
	if (schema.type === "integer") return Type.Integer();
	if (schema.type === "boolean") return Type.Boolean();
	if (schema.type === "null") return Type.Null();
	if (Array.isArray(schema.anyOf)) {
		return Type.Union(schema.anyOf.map(convertMcpJsonSchemaToTypeBox));
	}
	if (Array.isArray(schema.oneOf)) {
		return Type.Union(schema.oneOf.map(convertMcpJsonSchemaToTypeBox));
	}
	return Type.Any();
}

/** Execute one MCP call and preserve the existing model-visible result/error projection. */
export async function executeMcpToolCall(
	client: IMcpClient,
	mcpTool: McpTool,
	input: Readonly<Record<string, unknown>>,
	options?: McpToolCallExecutionOptions,
): Promise<RuntimeToolResult> {
	try {
		const result = await client.callTool(mcpTool.name, input as McpJsonObject);
		const resultPolicy = options?.resultPolicy ?? PRESERVE_MCP_TOOL_RESULT_POLICY;
		return resultPolicy.project(result, options?.context ?? directExecutionContext(mcpTool.name));
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Error calling MCP tool '${mcpTool.name}': ${errorMessage}` }],
			details: {
				content: [{ type: "text", text: errorMessage }],
				isError: true,
			},
		};
	}
}

export interface McpToolCallExecutionOptions {
	readonly context: McpToolResultContext;
	readonly resultPolicy: McpToolResultPolicy;
}

export interface McpRuntimeToolOptions {
	readonly resultPolicy: McpToolResultPolicy;
}

export function createMcpRuntimeTool(
	mcpTool: McpTool,
	client: IMcpClient,
	serverName: string,
	options: McpRuntimeToolOptions = DEFAULT_MCP_RUNTIME_TOOL_OPTIONS,
): RuntimeToolDefinition {
	return {
		name: `mcp_${serverName}_${mcpTool.name}`,
		label: `${serverName}: ${mcpTool.name}`,
		description: mcpTool.description || `MCP tool from ${serverName}`,
		inputSchema: convertMcpJsonSchemaToTypeBox(mcpTool.inputSchema),
		execute: (request) =>
			executeMcpToolCall(client, mcpTool, request.input, {
				resultPolicy: options.resultPolicy,
				context: {
					sessionId: request.sessionId,
					turnId: request.turnId,
					toolCallId: request.toolCallId,
					serverName,
					toolName: mcpTool.name,
				},
			}),
	};
}

const DEFAULT_MCP_RUNTIME_TOOL_OPTIONS: McpRuntimeToolOptions = Object.freeze({
	resultPolicy: PRESERVE_MCP_TOOL_RESULT_POLICY,
});

function directExecutionContext(toolName: string): McpToolResultContext {
	return {
		sessionId: "",
		turnId: "",
		toolCallId: "",
		serverName: "",
		toolName,
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function isLiteralValue(value: unknown): value is TLiteralValue {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
