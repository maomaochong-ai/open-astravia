import { CODING_AGENT_TOOL_CONSENT_FUNCTION } from "@vetta/coding-agent/function-extensions";
import { describe, expect, it } from "vitest";
import { createCliImHostFunctionSource } from "../src/rpc/runtime-host/cli-session-function-source.js";

describe("CLI IM host function source", () => {
	it("authorizes only the explicitly hosted attachment capability", async () => {
		const functions = createCliImHostFunctionSource();
		const request = {
			requestId: "request-1",
			sessionId: "session-1",
			reason: "heavy-side-effect" as const,
		};

		expect(functions.source.has(CODING_AGENT_TOOL_CONSENT_FUNCTION)).toBe(true);
		await expect(
			functions.source.invoke(CODING_AGENT_TOOL_CONSENT_FUNCTION, {
				...request,
				toolName: "im_send_attachment",
			}),
		).resolves.toBe("allow_session");
		await expect(
			functions.source.invoke(CODING_AGENT_TOOL_CONSENT_FUNCTION, {
				...request,
				toolName: "another_heavy_tool",
			}),
		).resolves.toBe("deny");

		functions.dispose();
		expect(functions.source.has(CODING_AGENT_TOOL_CONSENT_FUNCTION)).toBe(false);
	});
});
