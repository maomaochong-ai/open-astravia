import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createKbListTagsTool, type KbListTagsToolInput, type KbListTagsToolOptions } from "./kb-list-tags-tool.js";

export const KB_LIST_TAGS_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];
export const KB_LIST_TAGS_TOOL_REQUIRES = ["knowledge"] as const;
export const KB_LIST_TAGS_TOOL_CATEGORY = "kb-read" as const;

export interface KbListTagsToolRegistrationOptions extends KbListTagsToolOptions {
	readonly modelOrder?: number;
}

export function createKbListTagsToolRegistration(
	options: KbListTagsToolRegistrationOptions,
): CodingToolRegistration<KbListTagsToolInput> {
	const tool = createKbListTagsTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: KB_LIST_TAGS_TOOL_SCOPES,
		requires: KB_LIST_TAGS_TOOL_REQUIRES,
		modelOrder: options.modelOrder,
		category: KB_LIST_TAGS_TOOL_CATEGORY,
	};
}
