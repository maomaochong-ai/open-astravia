import type { ToolCallBlock } from "@shared/store/atoms";
import type { GroupBlock } from "./progressGroupModel";

export const WORK_ACTIVITY_PREVIEW_MAX_CHARACTERS = 80;

export type WorkGroupActivity = { type: "tool"; block: ToolCallBlock } | { type: "thinking"; preview: string };

/** Collapse streamed prose into one stable-width line while retaining its latest content. */
export function compactWorkActivityText(text: string, maxCharacters = WORK_ACTIVITY_PREVIEW_MAX_CHARACTERS): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized || maxCharacters <= 0) return "";
	const characters = Array.from(normalized);
	if (characters.length <= maxCharacters) return normalized;
	if (maxCharacters === 1) return "…";
	return `…${characters.slice(-(maxCharacters - 1)).join("")}`;
}

/**
 * Select the activity that best answers “what is the agent doing now?”.
 * A still-running tool wins over later settled calls because tool calls may execute concurrently.
 */
export function selectWorkGroupActivity(blocks: readonly GroupBlock[]): WorkGroupActivity | null {
	for (let index = blocks.length - 1; index >= 0; index--) {
		const block = blocks[index];
		if (block.type === "tool_call" && block.status === "pending") {
			return { type: "tool", block };
		}
	}

	for (let index = blocks.length - 1; index >= 0; index--) {
		const block = blocks[index];
		if (block.type === "tool_call") return { type: "tool", block };
		const preview = compactWorkActivityText(block.text);
		if (preview) return { type: "thinking", preview };
	}

	return null;
}
