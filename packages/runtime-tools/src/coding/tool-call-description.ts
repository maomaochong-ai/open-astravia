import { Type } from "@sinclair/typebox";

export const TOOL_CALL_DESCRIPTION_TEXT = "Brief user-facing reason for this tool call (max 100 chars).";

/** Shared optional model narration field for Coding Tool input schemas. */
export const ToolCallDescriptionSchema = Type.Optional(
	Type.String({
		description: TOOL_CALL_DESCRIPTION_TEXT,
		maxLength: 100,
	}),
);
