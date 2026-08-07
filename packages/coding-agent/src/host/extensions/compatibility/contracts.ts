import type { ExtensionEvent } from "../../../extensions/index.js";

export type CodingAgentExtensionRuntimeCapability =
	| "opaque-runtime-api"
	| "event-handler"
	| "tool"
	| "command"
	| "shortcut"
	| "message-renderer";

export type CodingAgentExtensionEventType = ExtensionEvent["type"];
export type CodingAgentExtensionEventCompatibilityStatus = "supported" | "unsupported" | "inapplicable";
export type CodingAgentExtensionEventCompatibilityProfile = Readonly<
	Record<CodingAgentExtensionEventType, CodingAgentExtensionEventCompatibilityStatus>
>;

export interface CodingAgentExtensionRegistrationSummary {
	readonly path: string;
	readonly events: readonly string[];
	readonly tools: readonly string[];
	readonly commands: readonly string[];
	readonly shortcuts: readonly string[];
	readonly flags: readonly string[];
	readonly messageRenderers: readonly string[];
}

export interface CodingAgentExtensionBootstrapContributions {
	readonly providers: readonly string[];
	readonly flags: readonly string[];
}

export interface CodingAgentExtensionRequirements {
	readonly extensionCount: number;
	readonly bootstrapContributions: CodingAgentExtensionBootstrapContributions;
	readonly registrations: readonly CodingAgentExtensionRegistrationSummary[];
	readonly requiredRuntimeCapabilities: readonly CodingAgentExtensionRuntimeCapability[];
}

export interface CodingAgentExtensionCompatibilityAssessment extends CodingAgentExtensionRequirements {
	readonly inapplicableRuntimeCapabilities: readonly CodingAgentExtensionRuntimeCapability[];
	readonly unmetRuntimeCapabilities: readonly CodingAgentExtensionRuntimeCapability[];
	readonly inapplicableEvents: readonly string[];
	readonly unsupportedEvents: readonly string[];
	readonly compatible: boolean;
}

export interface CodingAgentExtensionHostCapabilities {
	readonly runtimeActions: boolean;
	readonly eventProfile: CodingAgentExtensionEventCompatibilityProfile;
	readonly tools?: boolean;
	readonly commands?: boolean;
	readonly shortcuts?: boolean;
	readonly messageRenderers?: boolean;
	readonly inapplicableRuntimeCapabilities?: readonly CodingAgentExtensionRuntimeCapability[];
}
