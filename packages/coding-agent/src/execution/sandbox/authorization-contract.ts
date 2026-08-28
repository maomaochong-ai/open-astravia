import type { SandboxPermissionCapability, SandboxPermissionRequest } from "@vetta/runtime-core/sandbox";
import { defineSessionExtensionFunction } from "@vetta/runtime-core/session-extensions";

export const CODING_AGENT_SANDBOX_AUTHORIZATION_EXTENSION_ID = "coding-agent.sandbox-authorization";

export type CodingAgentSandboxAuthorizationDecision = "deny" | "allow_once" | "allow_session";

export interface CodingAgentSandboxAuthorizationFunctionRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly title: string;
	readonly message: string;
	readonly toolName: string;
	readonly capability: SandboxPermissionCapability;
	readonly target: string;
	readonly resolvedTarget: string;
	readonly grantRoot?: string;
	readonly command?: string;
	readonly sensitive: boolean;
}

export interface CodingAgentSandboxAuthorizationPort {
	isAvailable(): boolean;
	request(
		sessionId: string,
		request: SandboxPermissionRequest,
		sensitive: boolean,
		signal: AbortSignal,
	): Promise<CodingAgentSandboxAuthorizationDecision>;
}

export const CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION = defineSessionExtensionFunction<
	CodingAgentSandboxAuthorizationFunctionRequest,
	CodingAgentSandboxAuthorizationDecision
>(CODING_AGENT_SANDBOX_AUTHORIZATION_EXTENSION_ID, "request");
