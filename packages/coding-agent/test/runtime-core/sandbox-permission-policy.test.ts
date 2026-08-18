import type { SandboxPermissionContext, SandboxPermissionRequest } from "@vetta/runtime-core/sandbox";
import { describe, expect, it, vi } from "vitest";
import { confirmSandboxPermission } from "../../src/execution/sandbox/permission-policy.js";

const REQUEST: SandboxPermissionRequest = {
	capability: "file.write",
	toolName: "write",
	target: "../outside.txt",
	resolvedTarget: "/outside.txt",
	grantRoot: "/",
	reason: "outside workspace",
};

describe("Coding Agent sandbox permission policy", () => {
	it("downgrades a session grant for sensitive paths to a one-time grant", async () => {
		const requestSandboxGrant = vi.fn(async () => "allow_session" as const);
		const context: SandboxPermissionContext = {
			hasUI: true,
			ui: { confirm: async () => false, requestSandboxGrant },
		};

		await expect(confirmSandboxPermission(context, REQUEST, () => true)).resolves.toBe("allow_once");
		expect(requestSandboxGrant).toHaveBeenCalledWith(expect.objectContaining({ sensitive: true }));
	});

	it("honors ecosystem allow and deny decisions before opening host UI", async () => {
		const requestSandboxGrant = vi.fn(async () => "deny" as const);
		const allowContext: SandboxPermissionContext = {
			hasUI: true,
			ui: { confirm: async () => false, requestSandboxGrant },
			requestEcosystemPermission: async () => ({ decision: "allow" }),
		};
		const denyContext: SandboxPermissionContext = {
			...allowContext,
			requestEcosystemPermission: async () => ({ decision: "deny", message: "blocked" }),
		};

		await expect(confirmSandboxPermission(allowContext, REQUEST, () => false)).resolves.toBe("allow_once");
		await expect(confirmSandboxPermission(denyContext, REQUEST, () => false)).resolves.toBe("deny");
		expect(requestSandboxGrant).not.toHaveBeenCalled();
	});
});
