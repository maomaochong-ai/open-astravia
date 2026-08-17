export type {
	CodingAgentExtensionBootstrapContributions,
	CodingAgentExtensionCompatibilityAssessment,
	CodingAgentExtensionEventCompatibilityProfile,
	CodingAgentExtensionEventCompatibilityStatus,
	CodingAgentExtensionEventType,
	CodingAgentExtensionHostCapabilities,
	CodingAgentExtensionRegistrationSummary,
	CodingAgentExtensionRequirements,
	CodingAgentExtensionRuntimeCapability,
} from "./contracts.js";
export { collectCodingAgentExtensionRequirements } from "./requirements.js";
export {
	CODING_AGENT_EXTENSION_HOST_SUPPORTED_EVENTS,
	resolveCodingAgentExtensionCompatibility,
} from "./resolver.js";
