import type { CodingToolRegistration } from "../../tool-registration.js";
import type { EditToolOptions } from "./edit-contracts.js";
import { createEditTool } from "./edit-tool.js";
import type { EditToolInput } from "./schema.js";

export function createEditToolRegistration(
	cwd: string,
	options: EditToolOptions,
): CodingToolRegistration<EditToolInput> {
	return {
		tool: createEditTool(cwd, options),
	};
}
