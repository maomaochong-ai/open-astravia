import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type {
	AgentPluginContinuationResult,
	AgentPluginHandlerResult,
	AgentPluginRuntimeEffect,
} from "../../model-context/index.js";

const PromptBlockSourceSchema = Type.Object(
	{
		kind: Type.Union([Type.Literal("core"), Type.Literal("plugin")]),
		pluginId: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const PromptBlockTypeSchema = Type.Union([
	Type.Literal("subconscious"),
	Type.Literal("base"),
	Type.Literal("tools"),
	Type.Literal("mcp"),
	Type.Literal("guidelines"),
	Type.Literal("append"),
	Type.Literal("context"),
	Type.Literal("memory"),
	Type.Literal("skills"),
	Type.Literal("mode"),
	Type.Literal("personalization"),
	Type.Literal("footer"),
	Type.Literal("plugin"),
]);

const PromptBlockSchema = Type.Object(
	{
		id: Type.String(),
		type: PromptBlockTypeSchema,
		source: PromptBlockSourceSchema,
		content: Type.String(),
		priority: Type.Number(),
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const PromptBlockPatchSchema = Type.Partial(
	Type.Object(
		{
			type: PromptBlockTypeSchema,
			source: PromptBlockSourceSchema,
			content: Type.String(),
			priority: Type.Number(),
			enabled: Type.Boolean(),
		},
		{ additionalProperties: false },
	),
);

const ContinuationResultSchema = Type.Object(
	{
		text: Type.String(),
		idempotencyKey: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const RuntimeEffectSchema = Type.Union([
	Type.Object(
		{
			type: Type.Literal("addBlock"),
			block: PromptBlockSchema,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("replaceBlock"),
			blockId: Type.String(),
			block: PromptBlockSchema,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("updateBlock"),
			blockId: Type.String(),
			patch: PromptBlockPatchSchema,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("removeBlock"),
			blockId: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("setBlockEnabled"),
			blockId: Type.String(),
			enabled: Type.Boolean(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("setToolEnabled"),
			toolName: Type.String(),
			enabled: Type.Boolean(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("requestContinuation"),
			result: ContinuationResultSchema,
		},
		{ additionalProperties: false },
	),
]);

const RuntimeEffectsSchema = Type.Array(RuntimeEffectSchema);
const ContinuationHandlerResultSchema = Type.Object(
	{
		value: Type.Union([ContinuationResultSchema, Type.Null()]),
		effects: RuntimeEffectsSchema,
	},
	{ additionalProperties: false },
);
const ToolHandlerResultSchema = Type.Object(
	{
		value: Type.Unknown(),
		effects: RuntimeEffectsSchema,
	},
	{ additionalProperties: false },
);

export function validatePluginRuntimeEffects(value: unknown): readonly AgentPluginRuntimeEffect[] {
	if (!Value.Check(RuntimeEffectsSchema, value)) {
		throw new Error("Plugin system prompt provider returned invalid runtime effects");
	}
	return value as AgentPluginRuntimeEffect[];
}

export function validatePluginContinuationHandlerResult(
	value: unknown,
): AgentPluginHandlerResult<AgentPluginContinuationResult | null> {
	if (!Value.Check(ContinuationHandlerResultSchema, value)) {
		throw new Error("Plugin continuation provider returned an invalid result");
	}
	return value as AgentPluginHandlerResult<AgentPluginContinuationResult | null>;
}

export function validatePluginToolHandlerResult(value: unknown): AgentPluginHandlerResult<unknown> {
	if (!Value.Check(ToolHandlerResultSchema, value)) {
		throw new Error("Plugin tool returned an invalid result");
	}
	return value as AgentPluginHandlerResult<unknown>;
}
