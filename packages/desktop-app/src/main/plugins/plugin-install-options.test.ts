import { describe, expect, it } from "vitest";
import { assertPluginInstallIdentity, parsePluginInstallOptions } from "./plugin-install-options.js";

describe("parsePluginInstallOptions", () => {
	it("accepts a complete npm installation identity", () => {
		expect(
			parsePluginInstallOptions({
				source: "npm",
				expectedSha256: "a".repeat(64),
				expectedId: "demo",
				expectedVersion: "1.2.0",
				npm: {
					packageName: "@example/demo",
					requestedSpec: "@example/demo@1.2.0",
					resolvedVersion: "1.2.0",
				},
			}),
		).toMatchObject({ source: "npm", expectedId: "demo", expectedVersion: "1.2.0" });
	});

	it("rejects incomplete or drifting npm metadata", () => {
		expect(() => parsePluginInstallOptions({ source: "npm" })).toThrow("distribution metadata");
		expect(() =>
			parsePluginInstallOptions({
				source: "npm",
				expectedVersion: "1.2.0",
				npm: {
					packageName: "@example/demo",
					requestedSpec: "@example/demo",
					resolvedVersion: "1.3.0",
				},
			}),
		).toThrow("must match expectedVersion");
	});

	it("rejects an extracted plugin whose npm envelope identity drifted", () => {
		const options = parsePluginInstallOptions({
			source: "npm",
			expectedSha256: "a".repeat(64),
			expectedId: "demo",
			expectedVersion: "1.2.0",
			npm: {
				packageName: "@example/demo",
				requestedSpec: "@example/demo",
				resolvedVersion: "1.2.0",
			},
		});
		expect(() => assertPluginInstallIdentity({ id: "other", version: "1.2.0" }, options)).toThrow(
			"Plugin id mismatch",
		);
		expect(() => assertPluginInstallIdentity({ id: "demo", version: "1.3.0" }, options)).toThrow(
			"Plugin version mismatch",
		);
	});
});
