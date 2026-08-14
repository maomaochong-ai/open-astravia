import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import {
	createKbFilterByTagsTool,
	type KbFilterByTagsToolInput,
	type KbFilterByTagsToolOptions,
} from "./kb-filter-by-tags-tool.js";

export const KB_FILTER_BY_TAGS_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];
export const KB_FILTER_BY_TAGS_TOOL_REQUIRES = ["knowledge"] as const;
export const KB_FILTER_BY_TAGS_TOOL_CATEGORY = "kb-read" as const;

export interface KbFilterByTagsToolRegistrationOptions extends KbFilterByTagsToolOptions {
	readonly modelOrder?: number;
}

export function createKbFilterByTagsToolRegistration(
	options: KbFilterByTagsToolRegistrationOptions,
): CodingToolRegistration<KbFilterByTagsToolInput> {
	const tool = createKbFilterByTagsTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: KB_FILTER_BY_TAGS_TOOL_SCOPES,
		requires: KB_FILTER_BY_TAGS_TOOL_REQUIRES,
		modelOrder: options.modelOrder,
		category: KB_FILTER_BY_TAGS_TOOL_CATEGORY,
	};
}
