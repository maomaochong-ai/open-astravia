import { defineSessionExtensionEndpoint } from "@vetta/runtime-core/session-extensions";

export const CODING_AGENT_SESSION_ASSISTANCE_EXTENSION_ID = "coding-agent.session-assistance";

export interface CodingAgentSessionTitleRequest {
	readonly userText: string;
	readonly assistantText: string;
}

export const CODING_AGENT_SESSION_TITLE_GENERATE = defineSessionExtensionEndpoint<
	CodingAgentSessionTitleRequest,
	string | null
>(CODING_AGENT_SESSION_ASSISTANCE_EXTENSION_ID, "title.generate");

export const CODING_AGENT_NEXT_PROMPT_SUGGESTIONS = defineSessionExtensionEndpoint<
	{ readonly conversation: string },
	readonly string[]
>(CODING_AGENT_SESSION_ASSISTANCE_EXTENSION_ID, "next-prompts.generate");
