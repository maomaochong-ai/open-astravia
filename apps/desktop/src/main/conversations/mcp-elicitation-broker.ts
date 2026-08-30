import { randomUUID } from "node:crypto";
import type {
	McpElicitationCreateParams,
	McpElicitationField,
	McpElicitationResult,
	McpInteractionContext,
} from "@vetta/runtime-mcp/protocol";
import { isMcpElicitationCreateParams } from "@vetta/runtime-mcp/protocol";
import type {
	DesktopMcpElicitationField,
	DesktopMcpElicitationRequest,
	DesktopMcpElicitationResolvedEvent,
	DesktopMcpElicitationResponse,
	DesktopMcpElicitationValue,
} from "../../shared/mcp-interaction.js";

export type DesktopMcpElicitationHandler = (
	request: DesktopMcpElicitationRequest,
	signal?: AbortSignal,
) => Promise<DesktopMcpElicitationResponse>;

type ResolvedListener = (event: DesktopMcpElicitationResolvedEvent) => void;

const CANCELLED: McpElicitationResult = { action: "cancel" };
const MAX_FIELDS = 32;

/** Owns pending MCP elicitation lifecycle while Renderer remains a replaceable interaction adapter. */
export class DesktopMcpElicitationBroker {
	private interactiveHandler: DesktopMcpElicitationHandler | undefined;
	private readonly pending = new Map<string, DesktopMcpElicitationRequest>();
	private readonly resolvedListeners = new Set<ResolvedListener>();

	async handle(params: McpElicitationCreateParams, context: McpInteractionContext): Promise<McpElicitationResult> {
		if (context.signal?.aborted || !context.sessionId || !this.interactiveHandler) return CANCELLED;
		const request = createDesktopRequest(params, context);
		if (!request) return CANCELLED;
		this.pending.set(request.requestId, request);
		try {
			const response = await this.interactiveHandler(request, context.signal);
			if (!validateResponse(params, response)) return CANCELLED;
			return response.action === "accept"
				? { action: "accept", ...(response.content ? { content: { ...response.content } } : {}) }
				: { action: response.action };
		} finally {
			this.pending.delete(request.requestId);
			const event = { requestId: request.requestId, sessionId: request.sessionId };
			for (const listener of this.resolvedListeners) listener(event);
		}
	}

	listPending(): DesktopMcpElicitationRequest[] {
		return [...this.pending.values()];
	}

	setInteractiveHandler(handler: DesktopMcpElicitationHandler): () => void {
		this.interactiveHandler = handler;
		return () => {
			if (this.interactiveHandler === handler) this.interactiveHandler = undefined;
		};
	}

	onResolved(listener: ResolvedListener): () => void {
		this.resolvedListeners.add(listener);
		return () => this.resolvedListeners.delete(listener);
	}
}

const sharedBroker = new DesktopMcpElicitationBroker();

export function getDesktopMcpElicitationBroker(): DesktopMcpElicitationBroker {
	return sharedBroker;
}

function createDesktopRequest(
	params: McpElicitationCreateParams,
	context: McpInteractionContext,
): DesktopMcpElicitationRequest | undefined {
	if (!isMcpElicitationCreateParams(params) || !context.sessionId) return undefined;
	const base = {
		requestId: randomUUID(),
		sessionId: context.sessionId,
		serverName: context.serverName,
		message: params.message,
	} as const;
	if (params.mode === "url") {
		return isAllowedElicitationUrl(params.url) ? { ...base, mode: "url", url: params.url } : undefined;
	}
	const properties = Object.entries(params.requestedSchema.properties);
	if (properties.length > MAX_FIELDS) return undefined;
	const required = new Set(params.requestedSchema.required ?? []);
	return {
		...base,
		mode: "form",
		fields: properties.map(([key, schema]) => normalizeField(key, schema, required.has(key))),
	};
}

function normalizeField(key: string, schema: McpElicitationField, required: boolean): DesktopMcpElicitationField {
	const common = {
		key,
		title: schema.title ?? key,
		...(schema.description ? { description: schema.description } : {}),
		required,
	};
	if (schema.type === "array") {
		return {
			...common,
			kind: "multi-select",
			options: readMultiSelectOptions(schema),
			...(schema.default ? { defaultValue: schema.default } : {}),
			...(schema.minItems === undefined ? {} : { minItems: schema.minItems }),
			...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems }),
		};
	}
	if (schema.type === "string") {
		const options = readSingleSelectOptions(schema);
		return {
			...common,
			kind: options ? "single-select" : "string",
			...(options ? { options } : {}),
			...(schema.default === undefined ? {} : { defaultValue: schema.default }),
			...(schema.format === undefined ? {} : { format: schema.format }),
			...(schema.minLength === undefined ? {} : { minLength: schema.minLength }),
			...(schema.maxLength === undefined ? {} : { maxLength: schema.maxLength }),
		};
	}
	if (schema.type === "boolean") {
		return {
			...common,
			kind: "boolean",
			...(schema.default === undefined ? {} : { defaultValue: schema.default }),
		};
	}
	return {
		...common,
		kind: schema.type,
		...(schema.default === undefined ? {} : { defaultValue: schema.default }),
		...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
		...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
	};
}

function readSingleSelectOptions(
	schema: Extract<McpElicitationField, { type: "string" }>,
): DesktopMcpElicitationField["options"] {
	if (schema.oneOf) return schema.oneOf.map((item) => ({ value: item.const, label: item.title }));
	if (!schema.enum) return undefined;
	return schema.enum.map((value, index) => ({ value, label: schema.enumNames?.[index] ?? value }));
}

function readMultiSelectOptions(
	schema: Extract<McpElicitationField, { type: "array" }>,
): DesktopMcpElicitationField["options"] {
	if ("anyOf" in schema.items) {
		return schema.items.anyOf.map((item) => ({ value: item.const, label: item.title }));
	}
	return schema.items.enum.map((value) => ({ value, label: value }));
}

function validateResponse(params: McpElicitationCreateParams, response: DesktopMcpElicitationResponse): boolean {
	if (response.action !== "accept") return response.content === undefined;
	if (params.mode === "url") return response.content === undefined;
	if (!response.content || typeof response.content !== "object") return false;
	const required = new Set(params.requestedSchema.required ?? []);
	for (const key of required) if (!(key in response.content)) return false;
	for (const [key, value] of Object.entries(response.content)) {
		const schema = params.requestedSchema.properties[key];
		if (!schema || !validateFieldValue(schema, value)) return false;
	}
	return true;
}

function validateFieldValue(schema: McpElicitationField, value: DesktopMcpElicitationValue): boolean {
	if (schema.type === "boolean") return typeof value === "boolean";
	if (schema.type === "number" || schema.type === "integer") {
		if (typeof value !== "number" || !Number.isFinite(value)) return false;
		if (schema.type === "integer" && !Number.isInteger(value)) return false;
		return (
			(schema.minimum === undefined || value >= schema.minimum) &&
			(schema.maximum === undefined || value <= schema.maximum)
		);
	}
	if (schema.type === "array") {
		if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return false;
		const allowed = new Set(readMultiSelectOptions(schema)?.map((option) => option.value));
		return (
			(schema.minItems === undefined || value.length >= schema.minItems) &&
			(schema.maxItems === undefined || value.length <= schema.maxItems) &&
			value.every((item) => allowed.has(item))
		);
	}
	if (typeof value !== "string") return false;
	const options = readSingleSelectOptions(schema);
	return (
		(schema.minLength === undefined || value.length >= schema.minLength) &&
		(schema.maxLength === undefined || value.length <= schema.maxLength) &&
		(!options || options.some((option) => option.value === value))
	);
}

function isAllowedElicitationUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
	} catch {
		return false;
	}
}

function isLoopbackHost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
