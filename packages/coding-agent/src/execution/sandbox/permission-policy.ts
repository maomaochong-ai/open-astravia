import type { SandboxPermissionDecision, SandboxPermissionRequest } from "@vetta/runtime-core/sandbox";
import type { EcosystemPermissionHookRequest, EcosystemPermissionHookResult } from "../../extensions/ui-contracts.js";
import type { CodingAgentSandboxAuthorizationPort } from "./authorization-contract.js";

export interface CodingAgentSandboxPermissionContext {
	readonly authorization: CodingAgentSandboxAuthorizationPort;
	requestEcosystemPermission?(
		request: EcosystemPermissionHookRequest,
	): Promise<EcosystemPermissionHookResult | undefined>;
}

export function isSensitiveSandboxRequest(
	request: SandboxPermissionRequest,
	isDeniedPath: (targetPath: string) => boolean,
): boolean {
	if (isDeniedPath(request.resolvedTarget)) return true;
	return request.grantRoot ? isDeniedPath(request.grantRoot) : false;
}

export async function confirmSandboxPermission(
	context: CodingAgentSandboxPermissionContext,
	sessionId: string,
	request: SandboxPermissionRequest,
	isDeniedPath: (targetPath: string) => boolean,
	signal: AbortSignal,
): Promise<SandboxPermissionDecision> {
	if (typeof context.requestEcosystemPermission === "function") {
		try {
			const hookDecision = await context.requestEcosystemPermission({
				toolName: request.toolName,
				toolInput: {
					capability: request.capability,
					target: request.target,
					resolvedTarget: request.resolvedTarget,
					grantRoot: request.grantRoot,
					command: request.command,
					reason: request.reason,
				},
				runIdSuffix: `${request.capability}:${request.resolvedTarget}`,
				signal,
			});
			if (hookDecision?.decision === "deny") return "deny";
			if (hookDecision?.decision === "allow") return "allow_once";
		} catch {
			// Hook failure falls through to the host authorization function, which remains fail-closed.
		}
	}

	const sensitive = isSensitiveSandboxRequest(request, isDeniedPath);
	return context.authorization.request(sessionId, request, sensitive, signal);
}
