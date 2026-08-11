import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { CodingToolCategory } from "./tool-registration.js";

export interface CodingToolResultContext {
	readonly sessionId: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly category: CodingToolCategory;
}

export interface CodingToolResultPolicy {
	project(result: RuntimeToolResult, context: CodingToolResultContext): Promise<RuntimeToolResult>;
}

export const PRESERVE_CODING_TOOL_RESULT_POLICY: CodingToolResultPolicy = Object.freeze({
	async project(result: RuntimeToolResult) {
		return result;
	},
});
