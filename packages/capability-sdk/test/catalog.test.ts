import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { createCapabilityCatalog } from "../src/catalog.js";
import { CAPABILITY_LAYERS, CAPABILITY_PREFIXES, defineCapability } from "../src/contracts.js";
import { DOMAIN_CAPABILITY_CATALOG } from "../src/domain.js";
import { FOUNDATION_CAPABILITY_CATALOG } from "../src/foundation.js";
import { defineCapabilityInputSchema, defineCapabilityNoOutputSchema } from "../src/schema.js";

const catalogInputSchema = defineCapabilityInputSchema(
	Type.Unsafe<Record<string, never>>({ type: "object", additionalProperties: false }),
);

const catalogCapability = defineCapability<Record<string, never>, undefined>({
	id: `${CAPABILITY_PREFIXES.VETTA_DOMAIN}catalog.test`,
	kind: "command",
	layer: CAPABILITY_LAYERS.DOMAIN,
	version: 1,
	input: catalogInputSchema,
	output: defineCapabilityNoOutputSchema(),
});

describe("capability catalog", () => {
	it("rejects duplicate ids", () => {
		expect(() => createCapabilityCatalog([catalogCapability, catalogCapability])).toThrowError(
			"Capability catalog contains duplicate id",
		);
	});

	it("publishes immutable data without parser functions", () => {
		const catalog = createCapabilityCatalog([catalogCapability]);

		expect(Object.isFrozen(catalog)).toBe(true);
		expect(Object.isFrozen(catalog[0])).toBe(true);
		expect(Object.isFrozen(catalog[0]?.inputSchema)).toBe(true);
		expect(JSON.parse(JSON.stringify(catalog))).toEqual([
			{
				id: catalogCapability.id,
				inputSchema: { type: "object", additionalProperties: false },
				kind: "command",
				layer: "domain",
				outputSchema: false,
				version: 1,
			},
		]);
	});

	it("publishes complete layer catalogs with unique ids", () => {
		const catalog = [...FOUNDATION_CAPABILITY_CATALOG, ...DOMAIN_CAPABILITY_CATALOG];

		expect(FOUNDATION_CAPABILITY_CATALOG).toHaveLength(24);
		expect(DOMAIN_CAPABILITY_CATALOG).toHaveLength(102);
		expect(new Set(catalog.map(({ id }) => id)).size).toBe(126);
		expect(() => JSON.stringify(catalog)).not.toThrow();
	});
});
