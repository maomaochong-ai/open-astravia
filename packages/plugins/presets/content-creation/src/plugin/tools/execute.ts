import { Kind, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { ContentCreationAgentService } from "../../agent/service";
import type { ContentLocalAssetService } from "../../generation/local-asset-service";
import type { ContentRunApprovalStore } from "../run-approval";
import { CONTENT_ASSETS_INPUT_SCHEMA, executeContentAssets, type AssetsInput } from "./assets";
import { CONTENT_EXECUTION_OPERATIONS, type ContentExecutionOperation } from "./catalog";
import { CONTENT_EDIT_INPUT_SCHEMA, executeContentEdit, type EditInput } from "./edit";
import { CONTENT_INSPECT_INPUT_SCHEMA, executeContentInspect, type InspectInput } from "./inspect";
import { CONTENT_RUN_INPUT_SCHEMA, executeContentRun, type RunInput } from "./run";
import { CONTENT_TOOL_SCOPE_USE } from "./shared";

export const CONTENT_EXECUTE_TOOL_NAME = "content_creation_execute";

const CONTENT_EXECUTE_TOOL_DESCRIPTION = `
Execute one validated content-creation domain operation. Use content_creation_search first and copy the returned schema into input.

inspect is read-only; assets lists or imports authorized local media; edit atomically applies a revision-bound operation batch; run prepares, reads, or cancels generation. Nested input is validated again inside the plugin. Preparing a run never spends quota, and generation starts only after the user's global confirmation.
`.trim();

interface ExecuteInput {
	operation: ContentExecutionOperation;
	input: Record<string, unknown>;
}

const OPERATION_SCHEMAS: Readonly<Record<ContentExecutionOperation, TSchema>> = {
	inspect: toTypeBoxSchema(CONTENT_INSPECT_INPUT_SCHEMA),
	assets: toTypeBoxSchema(CONTENT_ASSETS_INPUT_SCHEMA),
	edit: toTypeBoxSchema(CONTENT_EDIT_INPUT_SCHEMA),
	run: toTypeBoxSchema(CONTENT_RUN_INPUT_SCHEMA),
};

export function registerContentExecuteTool(
	ctx: PluginContext,
	agent: ContentCreationAgentService,
	runApprovals: ContentRunApprovalStore,
	localAssets: ContentLocalAssetService,
): void {
	ctx.agent.registerTool<ExecuteInput>({
		id: "execute-content-creation-operation",
		name: CONTENT_EXECUTE_TOOL_NAME,
		label: "%tool.execute.label%",
		description: CONTENT_EXECUTE_TOOL_DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				operation: {
					type: "string",
					enum: CONTENT_EXECUTION_OPERATIONS,
					description: "Domain operation selected from content_creation_search.",
				},
				input: {
					type: "object",
					description: "Operation-specific input matching the schema returned by content_creation_search.",
					additionalProperties: true,
				},
			},
			required: ["operation", "input"],
			additionalProperties: false,
		},
		scope_use: CONTENT_TOOL_SCOPE_USE,
		handler: async ({ session, trigger }) => {
			const issue = validateContentOperationInput(trigger.input.operation, trigger.input.input);
			if (issue) return issue;
			switch (trigger.input.operation) {
				case "inspect":
					return executeContentInspect(agent, session.cwd, trigger.input.input as unknown as InspectInput);
				case "assets":
					return executeContentAssets(ctx, localAssets, session.cwd, trigger.input.input as unknown as AssetsInput);
				case "edit":
					return executeContentEdit(ctx, agent, session.cwd, trigger.input.input as unknown as EditInput);
				case "run":
					return executeContentRun(agent, runApprovals, session.cwd, trigger.input.input as unknown as RunInput);
			}
		},
	});
}

export function validateContentOperationInput(operation: ContentExecutionOperation, input: Record<string, unknown>) {
	const schema = OPERATION_SCHEMAS[operation];
	if (Value.Check(schema, input)) return undefined;
	const error = Value.Errors(schema, input).First();
	return {
		ok: false,
		retryable: true,
		code: "content-operation-input-invalid",
		error: error?.message ?? "content operation input is invalid",
		details: {
			operation,
			path: error?.path ?? "",
			hint: "Call content_creation_search with the exact operation ID and retry with the returned schema.",
		},
	};
}

function toTypeBoxSchema(value: unknown): TSchema {
	if (!isRecord(value)) return { [Kind]: "Any" } as TSchema;
	const result: Record<PropertyKey, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === "oneOf" && Array.isArray(child)) {
			result.anyOf = child.map(toTypeBoxSchema);
			continue;
		}
		if ((key === "anyOf" || key === "allOf") && Array.isArray(child)) {
			result[key] = child.map(toTypeBoxSchema);
			continue;
		}
		if (key === "properties" && isRecord(child)) {
			result.properties = Object.fromEntries(
				Object.entries(child).map(([name, schema]) => [name, toTypeBoxSchema(schema)]),
			);
			continue;
		}
		if (key === "items" && isRecord(child)) {
			result.items = toTypeBoxSchema(child);
			continue;
		}
		result[key] = child;
	}
	result[Kind] = schemaKind(result);
	return result as unknown as TSchema;
}

function schemaKind(schema: Record<PropertyKey, unknown>): string {
	if (Array.isArray(schema.anyOf)) return "Union";
	if (Array.isArray(schema.allOf)) return "Intersect";
	if (Object.hasOwn(schema, "const")) return "Literal";
	switch (schema.type) {
		case "object": return "Object";
		case "array": return "Array";
		case "string": return "String";
		case "number": return "Number";
		case "integer": return "Integer";
		case "boolean": return "Boolean";
		case "null": return "Null";
		default: return "Any";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
