import type { SandboxPermissionRequest } from "@vetta/runtime-core/sandbox";
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentSandboxAuthorizationPort } from "../../src/execution/sandbox/authorization-contract.js";
import {
	type CodingAgentSandboxPermissionContext,
	confirmSandboxPermission,
} from "../../src/execution/sandbox/permission-policy.js";

const REQUEST: SandboxPermissionRequest = {
	capability: "file.write",
	toolName: "write",
	target: "../outside.txt",
	resolvedTarget: "/outside.txt",
	grantRoot: "/",
	reason: "outside workspace",
};

describe("Coding Agent sandbox permission policy", () => {
	it("marks sensitive paths before delegating to product authorization", async () => {
		const request = vi.fn(async () => "allow_once" as const);
		const context: CodingAgentSandboxPermissionContext = {
			authorization: createAuthorization(request),
		};
		const signal = new AbortController().signal;

		await expect(confirmSandboxPermission(context, "session-1", REQUEST, () => true, signal)).resolves.toBe(
			"allow_once",
		);
		expect(request).toHaveBeenCalledWith("session-1", REQUEST, true, signal);
	});

	it("honors ecosystem allow and deny decisions before invoking product authorization", async () => {
		const request = vi.fn(async () => "deny" as const);
		const allowContext: CodingAgentSandboxPermissionContext = {
			authorization: createAuthorization(request),
			requestEcosystemPermission: async () => ({ decision: "allow" }),
		};
		const denyContext: CodingAgentSandboxPermissionContext = {
			...allowContext,
			requestEcosystemPermission: async () => ({ decision: "deny", message: "blocked" }),
		};
		const signal = new AbortController().signal;

		await expect(confirmSandboxPermission(allowContext, "session-1", REQUEST, () => false, signal)).resolves.toBe(
			"allow_once",
		);
		await expect(confirmSandboxPermission(denyContext, "session-1", REQUEST, () => false, signal)).resolves.toBe(
			"deny",
		);
		expect(request).not.toHaveBeenCalled();
	});
});

function createAuthorization(
	request: CodingAgentSandboxAuthorizationPort["request"],
): CodingAgentSandboxAuthorizationPort {
	return { isAvailable: () => true, request };
}
