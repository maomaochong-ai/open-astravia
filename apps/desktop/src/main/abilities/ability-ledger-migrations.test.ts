import { describe, expect, it } from "vitest";
import { migrateAbilityLedgerConfig } from "./ability-ledger-migrations";

describe("migrateAbilityLedgerConfig", () => {
	it("wraps the legacy flat ledger in a versioned entries object", () => {
		const result = migrateAbilityLedgerConfig({
			"mcp:github": {
				version: "1.0.0",
				installedAt: "2026-07-28T00:00:00.000Z",
			},
		});

		expect(result).toEqual({
			migrated: true,
			config: {
				schemaVersion: 2,
				entries: {
					"mcp:github": {
						version: "1.0.0",
						installedAt: "2026-07-28T00:00:00.000Z",
					},
				},
			},
		});
	});

	it("keeps a current ledger unchanged", () => {
		const current = { schemaVersion: 2, entries: {} };
		expect(migrateAbilityLedgerConfig(current)).toEqual({ migrated: false, config: current });
	});
});
