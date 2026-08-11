import type { ImageContent } from "@vetta/ai";
import type { PromptAttachmentRef, PromptResourceRef } from "@vetta/runtime-core";

export type CodingAgentPromptInputSource = "interactive" | "rpc" | "extension";

/** 单次 Prompt 的稳定公共输入；资源解析和队列实现仍由 Runtime 拥有。 */
export interface CodingAgentPromptOptions {
	expandPromptTemplates?: boolean;
	images?: ImageContent[];
	streamingBehavior?: "steer" | "followUp";
	promptRef?: PromptResourceRef;
	attachments?: PromptAttachmentRef[];
	source?: CodingAgentPromptInputSource;
	metadata?: Record<string, unknown>;
}
