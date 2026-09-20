import { describe, expect, it } from "vitest";
import { DEFAULT_COMPACTION_SETTINGS } from "../src/compaction/contracts.js";
import {
	CODING_AGENT_COMPACTION_CONFIGURATION,
	CODING_AGENT_COMPACTION_CONFIGURATION_ID,
} from "../src/public-api/settings.js";

describe("Coding Agent compaction Runtime Configuration", () => {
	it("publishes the existing product defaults for next-turn admission", () => {
		expect(CODING_AGENT_COMPACTION_CONFIGURATION_ID).toBe("coding.compaction");
		expect(CODING_AGENT_COMPACTION_CONFIGURATION.defaultValue).toEqual({
			enabled: DEFAULT_COMPACTION_SETTINGS.enabled,
			reserveTokens: DEFAULT_COMPACTION_SETTINGS.reserveTokens,
			contextThresholdPercent: 80,
			keepRecentTokens: DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
		});
		expect(CODING_AGENT_COMPACTION_CONFIGURATION.apply).toBe("next-turn");
	});

	it("accepts safe integer budgets and rejects invalid thresholds", () => {
		expect(
			CODING_AGENT_COMPACTION_CONFIGURATION.codec.decode({
				enabled: false,
				reserveTokens: 24_000,
				contextThresholdPercent: 85,
				keepRecentTokens: 12_000,
			}),
		).toEqual({
			enabled: false,
			reserveTokens: 24_000,
			contextThresholdPercent: 85,
			keepRecentTokens: 12_000,
		});
		expect(() =>
			CODING_AGENT_COMPACTION_CONFIGURATION.codec.decode({
				enabled: true,
				reserveTokens: 0,
				contextThresholdPercent: 80,
				keepRecentTokens: 20_000,
			}),
		).toThrow("reserveTokens");
		expect(() =>
			CODING_AGENT_COMPACTION_CONFIGURATION.codec.decode({
				enabled: true,
				reserveTokens: 36_000,
				contextThresholdPercent: 101,
				keepRecentTokens: 20_000,
			}),
		).toThrow("contextThresholdPercent");
	});
});
