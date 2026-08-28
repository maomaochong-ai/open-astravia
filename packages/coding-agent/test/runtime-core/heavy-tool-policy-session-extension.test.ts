import { SessionExtensionComposition, SessionExtensionFunctionRegistry } from "@vetta/runtime-core/session-extensions";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CODING_AGENT_HEAVY_TOOL_POLICY_RUNTIME,
	createCodingAgentHeavyToolPolicySessionExtension,
} from "../../src/tool-policy/heavy-tool-policy-session-extension.js";
import { CODING_AGENT_TOOL_CONSENT_FUNCTION } from "../../src/tool-policy/tool-consent-contract.js";

describe("Coding Agent heavy-tool-policy session extension", () => {
	const disposals: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		for (const dispose of disposals.splice(0).reverse()) await dispose();
	});

	it("adapts a dynamic function to the narrow consent port", async () => {
		const functions = new SessionExtensionFunctionRegistry();
		disposals.push(() => functions.close());
		const composition = await SessionExtensionComposition.create({
			createId: () => "consent-request-1",
			functions,
			definitions: [createCodingAgentHeavyToolPolicySessionExtension()],
		});
		disposals.push(() => composition.dispose());
		const runtime = composition.services.require(CODING_AGENT_HEAVY_TOOL_POLICY_RUNTIME);
		expect(runtime.consent.isAvailable()).toBe(false);

		const requestConsent = vi.fn(async () => "allow_session" as const);
		const unregister = functions.register(CODING_AGENT_TOOL_CONSENT_FUNCTION, requestConsent);
		expect(runtime.consent.isAvailable()).toBe(true);
		await expect(
			runtime.consent.request({ sessionId: "session-1", toolName: "vetd_create" }, new AbortController().signal),
		).resolves.toBe("allow_session");
		expect(requestConsent).toHaveBeenCalledWith(
			{
				requestId: "consent-request-1",
				sessionId: "session-1",
				toolName: "vetd_create",
				reason: "heavy-side-effect",
			},
			expect.any(AbortSignal),
		);

		unregister();
		expect(runtime.consent.isAvailable()).toBe(false);
	});
});
