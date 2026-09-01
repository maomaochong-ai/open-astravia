import { describe, expect, it, vi } from "vitest";
import { createTeamDelegateTool } from "../src/runtime-tools.js";

describe("team delegate runtime tool", () => {
	it("passes the runtime turn identity to the delegation port", async () => {
		const delegate = vi.fn().mockResolvedValue({
			memberId: "builder-1",
			memberHandle: "builder",
			summary: "Implemented the change",
		});
		const tool = createTeamDelegateTool({ delegate });

		const result = await tool.execute({
			sessionId: "leader-runtime",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: { target: "builder", objective: "Implement the change" },
			signal: new AbortController().signal,
		});

		expect(delegate).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceRuntimeSessionId: "leader-runtime",
				sourceTurnId: "turn-1",
				targetHandle: "builder",
				objective: "Implement the change",
			}),
		);
		expect(result.content).toEqual([{ type: "text", text: "Implemented the change" }]);
	});
});
