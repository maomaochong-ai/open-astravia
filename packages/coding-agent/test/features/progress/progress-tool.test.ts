import { describe, expect, it } from "vitest";
import { createProgressToolRegistration } from "../../../src/features/progress/index.js";

describe("progress Tool", () => {
	it("preserves registration metadata, result details and validation text", async () => {
		const registration = createProgressToolRegistration({ modelOrder: 1_600 });
		expect(registration).toMatchObject({
			category: "agent-control",
			modelOrder: 1_600,
			scopeUse: ["im-claw", "conversation", "project", "batch", "automation", "kb-processing", "cli"],
		});
		const success = await registration.tool.execute(request({ summary: "done", label: "next" }));
		const invalid = await registration.tool.execute(request({}));

		expect(success).toEqual({ content: [{ type: "text", text: "OK" }], details: { summary: "done", label: "next" } });
		expect(invalid.content[0]).toMatchObject({ text: expect.stringContaining("requires at least one") });
	});
});

function request(input: { readonly summary?: string; readonly label?: string }) {
	return {
		sessionId: "session",
		turnId: "turn",
		toolCallId: "call",
		input,
		signal: new AbortController().signal,
	};
}
