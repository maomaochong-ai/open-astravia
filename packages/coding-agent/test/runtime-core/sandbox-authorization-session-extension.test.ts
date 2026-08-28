import type { SandboxPermissionRequest } from "@vetta/runtime-core/sandbox";
import { SessionExtensionComposition, SessionExtensionFunctionRegistry } from "@vetta/runtime-core/session-extensions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION } from "../../src/execution/sandbox/authorization-contract.js";
import {
	CODING_AGENT_SANDBOX_AUTHORIZATION_RUNTIME,
	createCodingAgentSandboxAuthorizationSessionExtension,
} from "../../src/execution/sandbox/authorization-session-extension.js";

const REQUEST: SandboxPermissionRequest = {
	capability: "file.write",
	toolName: "write",
	target: "../outside.txt",
	resolvedTarget: "/outside.txt",
	grantRoot: "/",
	reason: "outside workspace",
};

describe("Coding Agent sandbox authorization session extension", () => {
	const disposals: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		for (const dispose of disposals.splice(0).reverse()) await dispose();
	});

	it("tracks dynamic availability, forwards request identity and limits sensitive grants", async () => {
		const { functions, authorization } = await createFixture();
		expect(authorization.isAvailable()).toBe(false);
		await expect(authorization.request("session-1", REQUEST, false, new AbortController().signal)).resolves.toBe(
			"deny",
		);

		const handler = vi.fn(async () => "allow_session" as const);
		const unregister = functions.register(CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION, handler);
		expect(authorization.isAvailable()).toBe(true);
		const signal = new AbortController().signal;

		await expect(authorization.request("session-1", REQUEST, true, signal)).resolves.toBe("allow_once");
		expect(handler).toHaveBeenCalledWith(
			{
				requestId: "sandbox-request-1",
				sessionId: "session-1",
				title: "沙箱权限请求",
				message: expect.stringContaining("该路径为敏感路径"),
				toolName: "write",
				capability: "file.write",
				target: "../outside.txt",
				resolvedTarget: "/outside.txt",
				grantRoot: "/",
				command: undefined,
				sensitive: true,
			},
			signal,
		);

		unregister();
		expect(authorization.isAvailable()).toBe(false);
	});

	it("fails closed on function errors but preserves cancellation", async () => {
		const errorFixture = await createFixture();
		errorFixture.functions.register(CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION, async () => {
			throw new Error("host failed");
		});
		await expect(
			errorFixture.authorization.request("session-1", REQUEST, false, new AbortController().signal),
		).resolves.toBe("deny");

		const abortFixture = await createFixture();
		abortFixture.functions.register(CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION, async (_request, signal) => {
			signal.throwIfAborted();
			return "allow_once";
		});
		const controller = new AbortController();
		controller.abort();
		await expect(
			abortFixture.authorization.request("session-1", REQUEST, false, controller.signal),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	async function createFixture() {
		const functions = new SessionExtensionFunctionRegistry();
		disposals.push(() => functions.close());
		const composition = await SessionExtensionComposition.create({
			createId: () => "sandbox-request-1",
			functions,
			definitions: [createCodingAgentSandboxAuthorizationSessionExtension()],
		});
		disposals.push(() => composition.dispose());
		return {
			functions,
			authorization: composition.services.require(CODING_AGENT_SANDBOX_AUTHORIZATION_RUNTIME),
		};
	}
});
