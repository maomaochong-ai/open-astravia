import { describe, expect, it } from "vitest";
import { PLUGIN_PERMISSIONS } from "../src/index.js";

describe("plugin-sdk public API", () => {
	it("exports the runtime permission catalog from the package root", () => {
		expect(PLUGIN_PERMISSIONS).toContain("network.fetch");
		expect(PLUGIN_PERMISSIONS).toContain("shell.openExternal");
	});
});
