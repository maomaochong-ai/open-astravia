import { defineSessionExtensionFunction } from "@vetta/runtime-core/session-extensions";

export const CODING_AGENT_HEAVY_TOOL_POLICY_EXTENSION_ID = "coding-agent.heavy-tool-policy";

export interface CodingAgentToolConsentRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly toolName: string;
	readonly reason: "heavy-side-effect";
}

export type CodingAgentToolConsentDecision = "allow_session" | "deny";

export const CODING_AGENT_TOOL_CONSENT_FUNCTION = defineSessionExtensionFunction<
	CodingAgentToolConsentRequest,
	CodingAgentToolConsentDecision
>(CODING_AGENT_HEAVY_TOOL_POLICY_EXTENSION_ID, "request-consent");
