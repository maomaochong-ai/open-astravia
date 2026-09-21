import type { RuntimeConfigurationDefinition, RuntimeConfigurationJsonObject } from "@vetta/runtime-core/configuration";
import { DEFAULT_COMPACTION_SETTINGS } from "../../compaction/contracts.js";

export const CODING_AGENT_COMPACTION_CONFIGURATION_ID = "coding.compaction";

export interface CodingAgentCompactionConfiguration extends RuntimeConfigurationJsonObject {
	readonly enabled: boolean;
	readonly reserveTokens: number;
	readonly contextThresholdPercent: number;
	readonly keepRecentTokens: number;
}

export const CODING_AGENT_COMPACTION_CONFIGURATION = Object.freeze({
	id: CODING_AGENT_COMPACTION_CONFIGURATION_ID,
	schemaVersion: 1,
	descriptor: {
		title: "Context compaction",
		description: "Controls when long conversations are compacted and how much recent context is kept verbatim.",
		schema: {
			type: "object",
			additionalProperties: false,
			required: ["enabled", "reserveTokens", "contextThresholdPercent", "keepRecentTokens"],
			properties: {
				enabled: { type: "boolean" },
				reserveTokens: { type: "integer", minimum: 1 },
				contextThresholdPercent: { type: "integer", minimum: 1, maximum: 100 },
				keepRecentTokens: { type: "integer", minimum: 0 },
			},
		},
		presentation: {
			group: "context",
			order: ["enabled", "reserveTokens", "contextThresholdPercent", "keepRecentTokens"],
		},
	},
	codec: { decode: decodeCodingAgentCompactionConfiguration },
	defaultValue: {
		enabled: DEFAULT_COMPACTION_SETTINGS.enabled,
		reserveTokens: DEFAULT_COMPACTION_SETTINGS.reserveTokens,
		contextThresholdPercent: 100 - DEFAULT_COMPACTION_SETTINGS.minFreePercent,
		keepRecentTokens: DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
	},
	apply: "next-turn",
} satisfies RuntimeConfigurationDefinition<CodingAgentCompactionConfiguration>);

function decodeCodingAgentCompactionConfiguration(value: unknown): CodingAgentCompactionConfiguration {
	if (!isRecord(value) || typeof value.enabled !== "boolean") {
		throw new TypeError("Invalid context compaction configuration");
	}
	return {
		enabled: value.enabled,
		reserveTokens: integerAtLeast(value.reserveTokens, "reserveTokens", 1),
		contextThresholdPercent: integerInRange(value.contextThresholdPercent, "contextThresholdPercent", 1, 100),
		keepRecentTokens: integerAtLeast(value.keepRecentTokens, "keepRecentTokens", 0),
	};
}

function integerAtLeast(value: unknown, field: string, minimum: number): number {
	return integerInRange(value, field, minimum, Number.MAX_SAFE_INTEGER);
}

function integerInRange(value: unknown, field: string, minimum: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new RangeError(`Invalid context compaction configuration field: ${field}`);
	}
	return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
