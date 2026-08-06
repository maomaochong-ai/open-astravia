import type { TSchema } from "@sinclair/typebox";
import { TypeGuard } from "@sinclair/typebox/type";
import { Value } from "@sinclair/typebox/value";
import { isCodingAgentBuiltInToolName } from "../../composition/coding-agent-built-in-tool-names.js";
import type { ExtensionContext, ToolDefinition } from "../../extensions/index.js";
import {
	CODING_AGENT_SESSION_CREATE_ERROR_CODES,
	CodingAgentSessionCreateError,
	type CodingAgentSessionToolDefinition,
} from "../../public-api/sdk/index.js";

export const CODING_AGENT_SDK_CUSTOM_TOOL_ERROR_CODES = {
	INVALID_SCHEMA: "greenfield_sdk_custom_tool_invalid_schema",
	INVALID_INPUT: "greenfield_sdk_custom_tool_invalid_input",
} as const;

export type CodingAgentSdkCustomToolErrorCode =
	(typeof CODING_AGENT_SDK_CUSTOM_TOOL_ERROR_CODES)[keyof typeof CODING_AGENT_SDK_CUSTOM_TOOL_ERROR_CODES];

export class CodingAgentSdkCustomToolError extends Error {
	constructor(
		readonly code: CodingAgentSdkCustomToolErrorCode,
		readonly toolName: string,
		message: string,
	) {
		super(message);
		this.name = "CodingAgentSdkCustomToolError";
	}
}

export interface CodingAgentSdkRegisteredTool {
	readonly definition: ToolDefinition;
	readonly extensionPath: string;
}

/** 将稳定 SDK 的窄 Tool 合同适配为产品 Extension Tool，不向调用方暴露具体上下文。 */
export function adaptPublicCodingAgentSdkCustomTools(
	customTools: readonly CodingAgentSessionToolDefinition[] | undefined,
): readonly CodingAgentSdkRegisteredTool[] | undefined {
	if (customTools === undefined) return undefined;
	return customTools.map((definition) => {
		if (!TypeGuard.IsSchema(definition.parameters)) {
			throw new CodingAgentSdkCustomToolError(
				CODING_AGENT_SDK_CUSTOM_TOOL_ERROR_CODES.INVALID_SCHEMA,
				definition.name,
				`SDK custom tool "${definition.name}" must declare a valid TypeBox schema`,
			);
		}
		const parameters = definition.parameters;
		const renderCall = definition.renderCall;
		const renderResult = definition.renderResult;
		const adaptedDefinition: ToolDefinition = {
			name: definition.name,
			label: definition.label,
			description: definition.description,
			parameters,
			scope_use: definition.scope_use,
			requires: definition.requires ? [...definition.requires] : undefined,
			category: definition.category,
			async execute(toolCallId, input, signal, onUpdate, context) {
				assertValidCodingAgentSdkCustomToolInput(definition.name, parameters, input);
				return definition.execute(toolCallId, input, signal, onUpdate, toPublicToolExecutionContext(context));
			},
			...(renderCall ? { renderCall: (args, currentTheme) => renderCall(args, currentTheme) } : {}),
			...(renderResult
				? {
						renderResult: (result, options, currentTheme) => renderResult(result, options, currentTheme),
					}
				: {}),
		};
		return { extensionPath: "<sdk>", definition: adaptedDefinition };
	});
}

export function resolvePublicSdkActiveToolNames(
	activeTools: readonly string[] | undefined,
): readonly string[] | undefined {
	if (activeTools === undefined) return undefined;
	return activeTools.map((name) => {
		if (!isCodingAgentBuiltInToolName(name)) {
			throw new CodingAgentSessionCreateError(
				CODING_AGENT_SESSION_CREATE_ERROR_CODES.INVALID_ACTIVE_TOOL,
				`Unknown Coding Agent built-in tool: ${name}`,
			);
		}
		return name;
	});
}

function assertValidCodingAgentSdkCustomToolInput(toolName: string, parameters: TSchema, input: unknown): void {
	if (Value.Check(parameters, input)) return;
	const issue = Value.Errors(parameters, input).First();
	const location = issue?.path ? ` at ${issue.path}` : "";
	const detail = issue?.message ? `: ${issue.message}` : "";
	throw new CodingAgentSdkCustomToolError(
		CODING_AGENT_SDK_CUSTOM_TOOL_ERROR_CODES.INVALID_INPUT,
		toolName,
		`Invalid input for SDK custom tool "${toolName}"${location}${detail}`,
	);
}

function toPublicToolExecutionContext(
	context: ExtensionContext,
): Parameters<CodingAgentSessionToolDefinition["execute"]>[4] {
	return context;
}
