import type { McpJsonObject, McpJsonValue, McpMeta } from "./json.js";
import type { McpClientInfo } from "./types.js";

export interface McpClientCapabilities {
	readonly experimental?: Record<string, McpJsonObject>;
	/** Deprecated in 2026-07-28; retained for legacy compatibility. */
	readonly roots?: McpJsonObject;
	/** Deprecated in 2026-07-28; retained for legacy compatibility. */
	readonly sampling?: { readonly context?: McpJsonObject; readonly tools?: McpJsonObject };
	readonly elicitation?: { readonly form?: McpJsonObject; readonly url?: McpJsonObject };
	readonly extensions?: Record<string, McpJsonObject>;
}

export interface McpRequestMeta extends McpMeta {
	readonly progressToken?: string | number;
	readonly "io.modelcontextprotocol/protocolVersion": string;
	readonly "io.modelcontextprotocol/clientInfo"?: McpClientInfo;
	readonly "io.modelcontextprotocol/clientCapabilities": McpClientCapabilities;
	/** Deprecated in 2026-07-28; opt-in is still required before receiving log notifications. */
	readonly "io.modelcontextprotocol/logLevel"?: string;
}

export interface McpRequestParams {
	readonly _meta: McpRequestMeta;
}

export interface McpServerInitiatedRequest {
	readonly method: string;
	readonly params?: McpJsonObject;
}

/** Keys are server-assigned correlation identifiers. */
export type McpInputRequests = Record<string, McpServerInitiatedRequest>;

/** Values are the ordinary result objects for their corresponding server requests. */
export type McpInputResponses = Record<string, McpJsonValue>;

export interface McpInputRequiredResult {
	readonly resultType: "input_required";
	readonly inputRequests?: McpInputRequests;
	readonly requestState?: string;
	readonly _meta?: McpMeta;
}

export interface McpInputResponseRequestParams extends McpRequestParams {
	readonly inputResponses?: McpInputResponses;
	readonly requestState?: string;
}

/** Host-only context. It is never serialized onto the MCP wire. */
export interface McpInteractionContext {
	readonly serverName: string;
	readonly method: string;
	readonly round: number;
	readonly signal?: AbortSignal;
	readonly sessionId?: string;
	readonly turnId?: string;
	readonly toolCallId?: string;
}

export interface McpSamplingCreateMessageParams extends McpJsonObject {
	readonly messages: McpJsonValue[];
	readonly maxTokens: number;
	readonly modelPreferences?: McpJsonObject;
	readonly systemPrompt?: string;
	readonly temperature?: number;
	readonly stopSequences?: string[];
	readonly metadata?: McpJsonObject;
	readonly tools?: McpJsonValue[];
	readonly toolChoice?: McpJsonObject;
}

export interface McpSamplingCreateMessageResult extends McpJsonObject {
	readonly role: "assistant";
	readonly content: McpJsonValue | McpJsonValue[];
	readonly model: string;
	readonly stopReason?: string;
}

export type McpElicitationValue = string | number | boolean | string[];

export interface McpElicitationFieldBase extends McpJsonObject {
	readonly title?: string;
	readonly description?: string;
}

export interface McpElicitationStringField extends McpElicitationFieldBase {
	readonly type: "string";
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly format?: "email" | "uri" | "date" | "date-time";
	readonly default?: string;
	readonly enum?: string[];
	readonly enumNames?: string[];
	readonly oneOf?: Array<{ readonly const: string; readonly title: string }>;
}

export interface McpElicitationNumberField extends McpElicitationFieldBase {
	readonly type: "number";
	readonly minimum?: number;
	readonly maximum?: number;
	readonly default?: number;
}

export interface McpElicitationIntegerField extends McpElicitationFieldBase {
	readonly type: "integer";
	readonly minimum?: number;
	readonly maximum?: number;
	readonly default?: number;
}

export interface McpElicitationBooleanField extends McpElicitationFieldBase {
	readonly type: "boolean";
	readonly default?: boolean;
}

export interface McpElicitationMultiSelectField extends McpElicitationFieldBase {
	readonly type: "array";
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly default?: string[];
	readonly items:
		| { readonly type: "string"; readonly enum: string[] }
		| { readonly anyOf: Array<{ readonly const: string; readonly title: string }> };
}

export type McpElicitationField =
	| McpElicitationStringField
	| McpElicitationNumberField
	| McpElicitationIntegerField
	| McpElicitationBooleanField
	| McpElicitationMultiSelectField;

export interface McpElicitationFormParams extends McpJsonObject {
	readonly mode?: "form";
	readonly message: string;
	readonly requestedSchema: {
		readonly $schema?: string;
		readonly type: "object";
		readonly properties: Record<string, McpElicitationField>;
		readonly required?: string[];
	};
}

export interface McpElicitationUrlParams extends McpJsonObject {
	readonly mode: "url";
	readonly message: string;
	readonly url: string;
}

export type McpElicitationCreateParams = McpElicitationFormParams | McpElicitationUrlParams;

export interface McpElicitationResult extends McpJsonObject {
	readonly action: "accept" | "decline" | "cancel";
	readonly content?: Record<string, McpElicitationValue>;
}

export interface McpRoot extends McpJsonObject {
	readonly uri: string;
	readonly name?: string;
}

export interface McpRootsListResult extends McpJsonObject {
	readonly roots: McpRoot[];
}

export interface McpServerInteractionHandlers {
	/** The host owns model selection, user approval and rate limiting. */
	readonly sampling?: (
		params: McpSamplingCreateMessageParams,
		context: McpInteractionContext,
	) => Promise<McpSamplingCreateMessageResult>;
	/** The host owns form validation, consent UI and URL allowlisting. */
	readonly elicitation?: (
		params: McpElicitationCreateParams,
		context: McpInteractionContext,
	) => Promise<McpElicitationResult>;
	/** Roots are informational and must already be permission-filtered by the host. */
	readonly roots?: (params: McpJsonObject, context: McpInteractionContext) => Promise<McpRootsListResult>;
}

export class McpInteractionUnsupportedError extends Error {
	readonly code = "MCP_INTERACTION_UNSUPPORTED" as const;
	readonly method: string;

	constructor(method: string) {
		super(`MCP interaction handler is not configured: ${method}`);
		this.name = "McpInteractionUnsupportedError";
		this.method = method;
	}
}

export class McpInteractionInvalidRequestError extends Error {
	readonly code = "MCP_INTERACTION_INVALID_REQUEST" as const;
	readonly method: string;

	constructor(method: string) {
		super(`Invalid MCP interaction request: ${method}`);
		this.name = "McpInteractionInvalidRequestError";
		this.method = method;
	}
}

/** Resolve the key-map carried by an InputRequiredResult without allowing arbitrary methods. */
export async function resolveMcpInputRequests(
	inputRequests: McpInputRequests,
	handlers: McpServerInteractionHandlers,
	context: McpInteractionContext,
): Promise<McpInputResponses> {
	const responses: McpInputResponses = {};
	for (const [key, request] of Object.entries(inputRequests)) {
		const params = isRecord(request.params) ? request.params : {};
		switch (request.method) {
			case "sampling/createMessage":
				if (!handlers.sampling) throw new McpInteractionUnsupportedError(request.method);
				if (!isMcpSamplingCreateMessageParams(params)) throw new McpInteractionInvalidRequestError(request.method);
				responses[key] = await handlers.sampling(params, context);
				break;
			case "elicitation/create":
				if (!handlers.elicitation) throw new McpInteractionUnsupportedError(request.method);
				if (!isMcpElicitationCreateParams(params)) throw new McpInteractionInvalidRequestError(request.method);
				responses[key] = await handlers.elicitation(params, context);
				break;
			case "roots/list":
				if (!handlers.roots) throw new McpInteractionUnsupportedError(request.method);
				responses[key] = await handlers.roots(params, context);
				break;
			default:
				throw new McpInteractionUnsupportedError(request.method);
		}
	}
	return responses;
}

export function isMcpElicitationCreateParams(value: unknown): value is McpElicitationCreateParams {
	if (!isRecord(value) || typeof value.message !== "string") return false;
	if (value.mode === "url") return typeof value.url === "string";
	if (value.mode !== undefined && value.mode !== "form") return false;
	if (!isRecord(value.requestedSchema) || value.requestedSchema.type !== "object") return false;
	if (!isRecord(value.requestedSchema.properties)) return false;
	if (
		value.requestedSchema.required !== undefined &&
		(!Array.isArray(value.requestedSchema.required) ||
			!value.requestedSchema.required.every((field) => typeof field === "string"))
	)
		return false;
	return Object.values(value.requestedSchema.properties).every(isMcpElicitationField);
}

function isMcpSamplingCreateMessageParams(value: unknown): value is McpSamplingCreateMessageParams {
	return (
		isRecord(value) &&
		Array.isArray(value.messages) &&
		typeof value.maxTokens === "number" &&
		Number.isInteger(value.maxTokens) &&
		value.maxTokens > 0
	);
}

function isMcpElicitationField(value: unknown): value is McpElicitationField {
	if (!isRecord(value) || typeof value.type !== "string") return false;
	if (value.type === "string") {
		if (value.enum !== undefined && !isStringArray(value.enum)) return false;
		if (value.enumNames !== undefined && !isStringArray(value.enumNames)) return false;
		if (value.oneOf !== undefined && !isTitledOptions(value.oneOf)) return false;
		return value.default === undefined || typeof value.default === "string";
	}
	if (value.type === "number" || value.type === "integer") {
		return value.default === undefined || typeof value.default === "number";
	}
	if (value.type === "boolean") return value.default === undefined || typeof value.default === "boolean";
	if (value.type !== "array" || !isRecord(value.items)) return false;
	const validItems =
		(value.items.type === "string" && isStringArray(value.items.enum)) || isTitledOptions(value.items.anyOf);
	return validItems && (value.default === undefined || isStringArray(value.default));
}

function isTitledOptions(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.every((option) => isRecord(option) && typeof option.const === "string" && typeof option.title === "string")
	);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
