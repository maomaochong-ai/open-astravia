import type {
	CodingAgentExtensionCompatibilityAssessment,
	CodingAgentExtensionEventCompatibilityProfile,
	CodingAgentExtensionEventCompatibilityStatus,
	CodingAgentExtensionEventType,
	CodingAgentExtensionHostCapabilities,
	CodingAgentExtensionRequirements,
} from "./contracts.js";

export const CODING_AGENT_EXTENSION_HOST_SUPPORTED_EVENTS = [
	"input",
	"before_agent_start",
	"session_start",
	"session_shutdown",
	"session_before_switch",
	"session_switch",
	"session_before_fork",
	"session_fork",
	"session_before_tree",
	"session_tree",
	"session_before_compact",
	"session_compact",
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"context",
	"tool_call",
	"tool_result",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_phase",
	"tool_execution_end",
	"model_select",
	"resources_discover",
] as const;

export function resolveCodingAgentExtensionCompatibility(
	requirements: CodingAgentExtensionRequirements,
	capabilities: CodingAgentExtensionHostCapabilities,
): CodingAgentExtensionCompatibilityAssessment {
	const inapplicableCapabilitySet = new Set(capabilities.inapplicableRuntimeCapabilities ?? []);
	const registeredEvents = requirements.registrations.flatMap((registration) => registration.events);
	const inapplicableEvents = sortedUnique(
		registeredEvents.filter((event) => resolveEventStatus(capabilities.eventProfile, event) === "inapplicable"),
	);
	const unsupportedEvents = sortedUnique(
		registeredEvents.filter((event) => resolveEventStatus(capabilities.eventProfile, event) === "unsupported"),
	);
	const inapplicableRuntimeCapabilities = requirements.requiredRuntimeCapabilities.filter((capability) =>
		inapplicableCapabilitySet.has(capability),
	);
	const unmetRuntimeCapabilities = requirements.requiredRuntimeCapabilities.filter((capability) => {
		if (inapplicableCapabilitySet.has(capability)) return false;
		if (capability === "opaque-runtime-api") return !capabilities.runtimeActions;
		if (capability === "event-handler") return unsupportedEvents.length > 0;
		if (capability === "tool") return capabilities.tools !== true;
		if (capability === "command") return capabilities.commands !== true;
		if (capability === "shortcut") return capabilities.shortcuts !== true;
		return capabilities.messageRenderers !== true;
	});

	return {
		...requirements,
		inapplicableRuntimeCapabilities,
		unmetRuntimeCapabilities,
		inapplicableEvents,
		unsupportedEvents,
		compatible: unmetRuntimeCapabilities.length === 0,
	};
}

function resolveEventStatus(
	profile: CodingAgentExtensionEventCompatibilityProfile,
	event: string,
): CodingAgentExtensionEventCompatibilityStatus {
	if (!Object.hasOwn(profile, event)) return "unsupported";
	return profile[event as CodingAgentExtensionEventType];
}

function sortedUnique(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort();
}
