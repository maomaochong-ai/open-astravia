import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { RuntimeConfigurationDefinition } from "@vetta/runtime-core/configuration";

const resourceId = Type.String({ minLength: 1, maxLength: 256, pattern: "^\\S(?:[^\\r\\n]*\\S)?$" });
const selection = Type.Union([Type.Null(), Type.Array(resourceId, { maxItems: 512, uniqueItems: true })]);
const thinkingLevel = Type.Union([
	Type.Null(),
	...(["off", "minimal", "low", "medium", "high", "xhigh"] as const).map((level) => Type.Literal(level)),
]);

/** null inherits the host surface; [] deliberately disables that resource kind. */
export const AgentConfigurationSchema = Type.Object(
	{
		appendSystemPrompt: Type.String({ maxLength: 64_000 }),
		skills: selection,
		tools: selection,
		mcpServers: selection,
		plugins: selection,
		modelKey: Type.Union([Type.Null(), Type.String({ minLength: 3, maxLength: 512, pattern: "^[^/\\s]+/\\S+$" })]),
		thinkingLevel,
	},
	{ additionalProperties: false },
);
export const AgentConfigurationPatchSchema = Type.Partial(AgentConfigurationSchema, { additionalProperties: false });
export const AgentConfigurationTemplateSchema = Type.Object(
	{
		id: resourceId,
		revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
		name: Type.String({ minLength: 1, maxLength: 128, pattern: "\\S" }),
		configuration: AgentConfigurationSchema,
	},
	{ additionalProperties: false },
);
export const AgentConfigurationSelectionSchema = Type.Object(
	{
		template: Type.Union([Type.Null(), AgentConfigurationTemplateSchema]),
		overrides: AgentConfigurationPatchSchema,
	},
	{ additionalProperties: false },
);
export const AgentConfigurationDocumentSchema = Type.Object(
	{
		schemaVersion: Type.Literal(1),
		revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
		selection: AgentConfigurationSelectionSchema,
	},
	{ additionalProperties: false },
);

export type AgentConfiguration = Static<typeof AgentConfigurationSchema>;
export type AgentConfigurationPatch = Static<typeof AgentConfigurationPatchSchema>;
export type AgentConfigurationTemplate = Static<typeof AgentConfigurationTemplateSchema>;
export type AgentConfigurationSelection = Static<typeof AgentConfigurationSelectionSchema>;
export type AgentConfigurationDocument = Static<typeof AgentConfigurationDocumentSchema>;
export type AgentConfigurationFailureCode =
	| "AGENT_CONFIGURATION_INVALID"
	| "AGENT_CONFIGURATION_CONFLICT"
	| "AGENT_CONFIGURATION_RESOURCE_UNAVAILABLE"
	| "AGENT_CONFIGURATION_APPLY_FAILED"
	| "AGENT_CONFIGURATION_NOT_READY"
	| "AGENT_CONFIGURATION_CLOSED";

export class AgentConfigurationError extends Error {
	constructor(readonly code: AgentConfigurationFailureCode) {
		super(code);
		this.name = "AgentConfigurationError";
	}
}

export const DEFAULT_AGENT_CONFIGURATION: AgentConfiguration = Object.freeze({
	appendSystemPrompt: "",
	skills: null,
	tools: null,
	mcpServers: null,
	plugins: null,
	modelKey: null,
	thinkingLevel: null,
});

export function parseAgentConfiguration(value: unknown): AgentConfiguration {
	if (!Value.Check(AgentConfigurationSchema, value)) throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
	return freezeConfiguration(structuredClone(value));
}

export function parseAgentConfigurationTemplate(value: unknown): AgentConfigurationTemplate {
	if (!Value.Check(AgentConfigurationTemplateSchema, value))
		throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
	return freezeConfiguration(structuredClone(value));
}

export function parseAgentConfigurationSelection(value: unknown): AgentConfigurationSelection {
	if (!Value.Check(AgentConfigurationSelectionSchema, value))
		throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
	return freezeConfiguration(structuredClone(value));
}

export function parseAgentConfigurationDocument(value: unknown): AgentConfigurationDocument {
	if (!Value.Check(AgentConfigurationDocumentSchema, value))
		throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
	return freezeConfiguration(structuredClone(value));
}

export function freezeConfiguration<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const child of Object.values(value)) freezeConfiguration(child);
		Object.freeze(value);
	}
	return value;
}

export const AGENT_CONFIGURATION_DEFINITION: RuntimeConfigurationDefinition<AgentConfiguration> = Object.freeze({
	id: "coding-agent.configuration",
	schemaVersion: 1,
	descriptor: {
		title: "Agent configuration",
		schema: AgentConfigurationSchema,
		sensitivePaths: ["/appendSystemPrompt"],
	},
	codec: { decode: parseAgentConfiguration },
	defaultValue: DEFAULT_AGENT_CONFIGURATION,
	apply: "next-turn",
});
