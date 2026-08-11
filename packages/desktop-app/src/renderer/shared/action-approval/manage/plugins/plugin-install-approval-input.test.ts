import { describe, expect, it } from "vitest";
import { buildInstallFromPathApprovalInput } from "./plugin-install-approval-input.js";

describe("buildInstallFromPathApprovalInput", () => {
	it("preserves npm identity fields through approval", () => {
		const input = buildInstallFromPathApprovalInput(
			{
				operation: "install-from-path",
				path: "C:/tmp/vetta-plugin.zip",
				source: "npm",
				expectedSha256: "a".repeat(64),
				expectedId: "demo",
				expectedVersion: "1.2.0",
				npm: {
					packageName: "@example/demo",
					requestedSpec: "@example/demo@1.2.0",
					resolvedVersion: "1.2.0",
					integrity: "sha512-fixture",
				},
			},
			" C:/tmp/vetta-plugin.zip ",
		);

		expect(input).toMatchObject({
			source: "npm",
			expectedId: "demo",
			expectedVersion: "1.2.0",
			path: "C:/tmp/vetta-plugin.zip",
			npm: { packageName: "@example/demo", resolvedVersion: "1.2.0" },
		});
	});
});
