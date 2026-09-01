import { type AgentTeamExtensionContribution, AgentTeamExtensionRegistryHost } from "@vetta/agent-team";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("agent-team-extensions");

/**
 * Trusted host extensions register executable policies here. Untrusted plugin manifests may only
 * select declared capability ids; they never become executable policy code at this boundary.
 */
export const agentTeamExtensionHost = new AgentTeamExtensionRegistryHost();

/** Trusted Desktop extensions use this boundary so registration and release are observable. */
export function registerAgentTeamExtension(
	extensionId: string,
	contribution: AgentTeamExtensionContribution,
	options: { readonly replace?: boolean } = {},
): () => void {
	const normalizedId = extensionId.normalize("NFKC").trim();
	if (!normalizedId) throw new Error("Agent Team extension id must not be empty");
	try {
		const unregister = agentTeamExtensionHost.register(contribution, options);
		log.info("agent team extension registered", {
			extensionId: normalizedId,
			orchestrationPolicyCount: contribution.orchestrationPolicies?.size ?? 0,
			contextPolicyCount: contribution.contextPolicies?.size ?? 0,
		});
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			unregister();
			log.info("agent team extension unregistered", { extensionId: normalizedId });
		};
	} catch (error) {
		logAgentTeamExtensionFailure(normalizedId, error);
		throw error;
	}
}

export function logAgentTeamExtensionFailure(extensionId: string, error: unknown): void {
	log.error("agent team extension registration failed", {
		extensionId,
		error: error instanceof Error ? error.message : String(error),
	});
}
