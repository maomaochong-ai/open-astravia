import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const MAX_PLUGIN_PROMPT_CONTEXT_BYTES = 256 * 1024;

const PluginPromptContextSchema = Type.Object(
	{
		schema: Type.String({ minLength: 1, maxLength: 160 }),
		version: Type.Integer({ minimum: 1 }),
		payload: Type.Record(Type.String(), Type.Unknown()),
	},
	{ additionalProperties: false },
);

export type PluginPromptContextJsonValue =
	| null
	| boolean
	| number
	| string
	| PluginPromptContextJsonValue[]
	| { [key: string]: PluginPromptContextJsonValue };

/** Versioned, JSON-safe application state attached to an outgoing prompt. */
export interface PluginPromptContext<TPayload extends object = object> {
	/** Namespaced context contract, for example `vetta.content-creation.node-selection`. */
	schema: string;
	version: number;
	payload: TPayload;
}

/**
 * Validate a plugin-owned context before handing it to the host. The generic
 * preserves the plugin's domain type while the runtime guard enforces a
 * bounded, serializable cross-plugin contract.
 */
export function definePluginPromptContext<TPayload extends object>(
	context: PluginPromptContext<TPayload>,
): PluginPromptContext<TPayload> {
	if (!Value.Check(PluginPromptContextSchema, context) || !isJsonValue(context.payload)) {
		throw new Error("Plugin prompt context must be a versioned JSON object");
	}
	const serialized = JSON.stringify(context);
	if (new TextEncoder().encode(serialized).byteLength > MAX_PLUGIN_PROMPT_CONTEXT_BYTES) {
		throw new Error(`Plugin prompt context exceeds ${MAX_PLUGIN_PROMPT_CONTEXT_BYTES} bytes`);
	}
	return context;
}

function isJsonValue(value: unknown): value is PluginPromptContextJsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	return (prototype === Object.prototype || prototype === null) && Object.values(value).every(isJsonValue);
}

/**
 * Plugin-owned context shown in the input bar and attached to outgoing prompts.
 * Legacy metadata/instructions remain supported; new domain data should use
 * the structured `context` field instead of encoding state in instructions.
 */
export interface PluginPromptAttachment<TPayload extends object = object> {
	id: string;
	label: string;
	icon?: string;
	/** Defaults to `once`; `sticky` remains attached until explicitly cleared. */
	lifecycle?: "once" | "sticky";
	context?: PluginPromptContext<TPayload>;
	instructions?: string[];
	metadata?: Record<string, unknown>;
}
