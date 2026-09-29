import { describe, expect, it } from "vitest";
import { migrateVersionedConfig } from "../src/versioned-config.js";

describe("migrateVersionedConfig future versions", () => {
	it("rejects a future schema by default", () => {
		expect(() =>
			migrateVersionedConfig({ schemaVersion: 3, future: true }, { currentVersion: 2, migrations: [] }),
		).toThrow("Unsupported config version v3");
	});

	it("preserves a future schema when the caller opts into downgrade compatibility", () => {
		const value = { schemaVersion: 3, future: { enabled: true } };
		expect(
			migrateVersionedConfig(value, {
				currentVersion: 2,
				migrations: [],
				futureVersionPolicy: "preserve",
			}),
		).toEqual({ config: value, migrated: false });
	});
});
