import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "../src/manifest.js";

const baseManifest = {
	id: "runtime-test",
	name: "Runtime test",
	version: "1.0.0",
	pluginApiVersion: "^1.0.0",
	entry: "dist/index.js",
} as const;

describe("plugin manifest runtime", () => {
	it.each(["esm", "module-federation"] as const)("accepts the supported %s runtime", (runtime) => {
		const moduleFederation =
			runtime === "module-federation" ? { remoteName: "runtime_test", expose: "./plugin" } : undefined;
		expect(parsePluginManifest({ ...baseManifest, runtime, moduleFederation }).runtime).toBe(runtime);
	});
});
