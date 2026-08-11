import type {
	CodingAgentExtensionRegistrationSummary,
	CodingAgentExtensionRequirements,
	CodingAgentExtensionRuntimeCapability,
} from "./contracts.js";

interface CodingAgentLoadedExtensionRegistrations {
	readonly path: string;
	readonly handlers: ReadonlyMap<string, readonly unknown[]>;
	readonly tools: ReadonlyMap<unknown, unknown>;
	readonly commands: ReadonlyMap<unknown, unknown>;
	readonly shortcuts: ReadonlyMap<unknown, unknown>;
	readonly flags: ReadonlyMap<unknown, unknown>;
	readonly messageRenderers: ReadonlyMap<unknown, unknown>;
}

interface CollectCodingAgentExtensionRequirementsInput {
	readonly extensions: readonly CodingAgentLoadedExtensionRegistrations[];
	readonly pendingProviderNames: readonly string[];
}

const RUNTIME_CAPABILITY_ORDER: readonly CodingAgentExtensionRuntimeCapability[] = [
	"opaque-runtime-api",
	"event-handler",
	"tool",
	"command",
	"shortcut",
	"message-renderer",
];

export function collectCodingAgentExtensionRequirements(
	input: CollectCodingAgentExtensionRequirementsInput,
): CodingAgentExtensionRequirements {
	const registrations = input.extensions
		.map(summarizeExtensionRegistrations)
		.sort((left, right) => left.path.localeCompare(right.path));
	const required = new Set<CodingAgentExtensionRuntimeCapability>();
	if (registrations.length > 0) required.add("opaque-runtime-api");

	for (const registration of registrations) {
		if (registration.events.length > 0) required.add("event-handler");
		if (registration.tools.length > 0) required.add("tool");
		if (registration.commands.length > 0) required.add("command");
		if (registration.shortcuts.length > 0) required.add("shortcut");
		if (registration.messageRenderers.length > 0) required.add("message-renderer");
	}

	return {
		extensionCount: registrations.length,
		bootstrapContributions: {
			providers: sortedUnique(input.pendingProviderNames),
			flags: sortedUnique(registrations.flatMap((registration) => registration.flags)),
		},
		registrations,
		requiredRuntimeCapabilities: RUNTIME_CAPABILITY_ORDER.filter((capability) => required.has(capability)),
	};
}

function summarizeExtensionRegistrations(
	extension: CodingAgentLoadedExtensionRegistrations,
): CodingAgentExtensionRegistrationSummary {
	return {
		path: extension.path,
		events: [...extension.handlers]
			.filter(([, handlers]) => handlers.length > 0)
			.map(([event]) => event)
			.sort(),
		tools: sortedMapKeys(extension.tools),
		commands: sortedMapKeys(extension.commands),
		shortcuts: sortedMapKeys(extension.shortcuts),
		flags: sortedMapKeys(extension.flags),
		messageRenderers: sortedMapKeys(extension.messageRenderers),
	};
}

function sortedMapKeys(map: ReadonlyMap<unknown, unknown>): readonly string[] {
	return sortedUnique([...map.keys()].map(String));
}

function sortedUnique(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort();
}
