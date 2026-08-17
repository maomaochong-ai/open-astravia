import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { CodingToolCategory } from "./tool-registration.js";

export interface CodingToolResultContext {
	readonly sessionId: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly category: CodingToolCategory;
}

export interface CodingToolResultArtifactWriteRequest {
	readonly sessionId: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly mediaType: "application/json";
	readonly data: string;
	readonly byteLength: number;
}

export interface CodingToolResultArtifact {
	readonly reference: string;
}

export interface CodingToolResultArtifactStore {
	write(request: CodingToolResultArtifactWriteRequest): Promise<CodingToolResultArtifact>;
}

export interface CodingToolResultPolicy {
	project(result: RuntimeToolResult, context: CodingToolResultContext): Promise<RuntimeToolResult>;
}

export const PRESERVE_CODING_TOOL_RESULT_POLICY: CodingToolResultPolicy = Object.freeze({
	async project(result: RuntimeToolResult) {
		return result;
	},
});
