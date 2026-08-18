import { describe, expect, it } from "vitest";
import { pluginHandlerGenerationKey } from "./plugin-handler-generation-key.js";

describe("pluginHandlerGenerationKey", () => {
	it("keeps same-id activation handlers in separate Renderer slots", () => {
		expect(pluginHandlerGenerationKey("demo", "shared", "activation-1")).not.toBe(
			pluginHandlerGenerationKey("demo", "shared", "activation-2"),
		);
		expect(pluginHandlerGenerationKey("demo", "shared")).toBe("demo:shared:legacy");
	});
});
