import { type Static, Type } from "@sinclair/typebox";

export const AnchorEditInputSchema = Type.Object({
	anchor: Type.String({
		description:
			'Start anchor: the WHOLE "line:hash" prefix copied VERBATIM from read/grep/edit output (e.g. "42:h7x2" — the line number is part of the anchor). Never fabricate.',
	}),
	end_anchor: Type.Optional(
		Type.String({
			description:
				"Inclusive end anchor: its entire line is replaced too. If that line contains a closing brace, bracket, or JSX tag that should remain, include it in new_text.",
		}),
	),
	new_text: Type.String({
		description: "Replacement for the range (may be multi-line). Empty string deletes the line(s).",
	}),
	insert_after: Type.Optional(
		Type.Boolean({
			description:
				"true = insert new_text AFTER the anchor line instead of replacing it (end_anchor must be omitted).",
		}),
	),
});

export const EditToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	oldText: Type.Optional(Type.String({ description: "Exact text to find and replace (must match exactly)" })),
	newText: Type.Optional(Type.String({ description: "New text to replace the old text with" })),
	edits: Type.Optional(
		Type.Array(AnchorEditInputSchema, {
			description:
				"Anchor-mode batch edits (preferred). Atomic: if ANY anchor is stale the whole batch is rejected and fresh anchors are returned — retry the full batch with them. Do not combine with oldText/newText.",
		}),
	),
});

export type AnchorEditInput = Static<typeof AnchorEditInputSchema>;
export type EditToolInput = Static<typeof EditToolInputSchema>;
