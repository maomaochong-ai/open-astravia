import {
	createModelOnlyToolInputPropertyProjector,
	RuntimeToolProjectionPipeline,
	type RuntimeToolProjector,
	TOOL_CALL_DESCRIPTION_TEXT,
	ToolCallDescriptionSchema,
} from "@vetta/runtime-tools";

export const CODING_AGENT_TOOL_PROJECTION_ORDER = {
	callDescription: 100,
} as const;

export const CODING_AGENT_CALL_DESCRIPTION_PROJECTOR_ID = "coding-agent.call-description";

/** Product default for model-authored, per-call narration consumed by Work-mode UI. */
export function createCodingAgentCallDescriptionProjector(): RuntimeToolProjector {
	return createModelOnlyToolInputPropertyProjector({
		id: CODING_AGENT_CALL_DESCRIPTION_PROJECTOR_ID,
		order: CODING_AGENT_TOOL_PROJECTION_ORDER.callDescription,
		propertyName: "description",
		propertySchema: ToolCallDescriptionSchema,
		adoptExistingProperty: (schema) =>
			schema.type === "string" && schema.maxLength === 100 && schema.description === TOOL_CALL_DESCRIPTION_TEXT,
		onConflict: "preserve",
		onUnsupportedSchema: "preserve",
	});
}

export function createCodingAgentToolProjectionPipeline(
	additionalProjectors: readonly RuntimeToolProjector[] = [],
): RuntimeToolProjectionPipeline {
	return new RuntimeToolProjectionPipeline([createCodingAgentCallDescriptionProjector(), ...additionalProjectors]);
}
