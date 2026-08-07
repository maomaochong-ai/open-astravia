import { describe, expect, it } from "vitest";
import { SubagentTypeRegistry } from "../src/index.js";
import { type TestProfile, typeDefinition } from "./support/builders.js";

describe("SubagentTypeRegistry", () => {
	it("normalizes the stored definition id together with its lookup key", () => {
		const registry = new SubagentTypeRegistry<TestProfile>().register({
			...typeDefinition("explorer"),
			id: "  explorer  ",
		});

		expect(registry.ids()).toEqual(["explorer"]);
		expect(registry.get("explorer")?.id).toBe("explorer");
	});
});
