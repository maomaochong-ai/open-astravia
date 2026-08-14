import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createKbWritePageTool, type KbWritePageToolInput, type KbWritePageToolOptions } from "./kb-write-page-tool.js";

export const KB_WRITE_PAGE_TOOL_SCOPES = ["kb-processing"] as const satisfies readonly CodingToolScope[];
export const KB_WRITE_PAGE_TOOL_REQUIRES = ["knowledge"] as const;
export const KB_WRITE_PAGE_TOOL_CATEGORY = "kb-write" as const;

export interface KbWritePageToolRegistrationOptions extends KbWritePageToolOptions {
	readonly modelOrder?: number;
}

export function createKbWritePageToolRegistration(
	options: KbWritePageToolRegistrationOptions,
): CodingToolRegistration<KbWritePageToolInput> {
	const tool = createKbWritePageTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: KB_WRITE_PAGE_TOOL_SCOPES,
		requires: KB_WRITE_PAGE_TOOL_REQUIRES,
		modelOrder: options.modelOrder,
		category: KB_WRITE_PAGE_TOOL_CATEGORY,
		// 写入宿主托管的知识库而非用户工作区，且页面可编辑恢复，不判 heavy。
		sideEffect: "light",
	};
}
