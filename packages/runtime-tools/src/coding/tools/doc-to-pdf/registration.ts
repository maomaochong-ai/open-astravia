import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createDocToPdfTool, type DocToPdfToolInput, type DocToPdfToolOptions } from "./doc-to-pdf-tool.js";

export const DOC_TO_PDF_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];
export const DOC_TO_PDF_TOOL_AGENT_MODES = ["work"] as const;
export const DOC_TO_PDF_TOOL_CATEGORY = "doc" as const;

export function createDocToPdfToolRegistration(
	cwd: string,
	options: DocToPdfToolOptions,
): CodingToolRegistration<DocToPdfToolInput> {
	return {
		tool: createDocToPdfTool(cwd, options),
		scopeUse: DOC_TO_PDF_TOOL_SCOPES,
		agentModes: DOC_TO_PDF_TOOL_AGENT_MODES,
		modelOrder: options.modelOrder,
		category: DOC_TO_PDF_TOOL_CATEGORY,
	};
}
