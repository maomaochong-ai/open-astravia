import { PROVIDER_ICONS } from "@vetta/theme-ui/shared";
import { describe, expect, it } from "vitest";
import { PRESET_PROVIDERS } from "./catalog";

describe("preset provider icon contract", () => {
	it("registers every icon referenced by the Desktop preset catalog", () => {
		for (const provider of PRESET_PROVIDERS) {
			expect(PROVIDER_ICONS[provider.icon], `${provider.id} references an unknown icon`).toEqual(expect.any(String));
		}
	});
});
