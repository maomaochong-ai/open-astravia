import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CODING_TOOL_SCOPES,
	CURRENT_TIME_TOOL_CATEGORY,
	CURRENT_TIME_TOOL_SCOPES,
	CurrentTimeToolInputSchema,
	createCurrentTimeToolRegistration,
	selectCodingToolsForScope,
} from "../../src/coding/index.js";

afterEach(() => {
	vi.useRealTimers();
});

describe("current_time runtime contract", () => {
	it("keeps the public definition and full scenario exposure", () => {
		const registration = createCurrentTimeToolRegistration();
		expect(registration.tool).toMatchObject({
			name: "current_time",
			label: "Current Time",
			inputSchema: CurrentTimeToolInputSchema,
		});
		expect(registration.tool.description).toContain("YYYY-MM-DD HH:mm:ss");
		expect(registration.scopeUse).toEqual(CURRENT_TIME_TOOL_SCOPES);
		expect(registration.category).toBe(CURRENT_TIME_TOOL_CATEGORY);
		for (const scenario of CODING_TOOL_SCOPES) {
			expect(selectCodingToolsForScope([registration], scenario)).toEqual([registration.tool]);
		}
	});

	it.each([false, true])("returns deterministic local time when aborted=%s", async (aborted) => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 6, 26, 14, 30, 45));
		const controller = new AbortController();
		if (aborted) controller.abort();
		const result = await createCurrentTimeToolRegistration().tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "runtime-call",
			input: { description: "Check the time" },
			signal: controller.signal,
		});
		expect(result).toEqual({
			content: [{ type: "text", text: "2026-07-26 14:30:45" }],
			details: { timestamp: "2026-07-26 14:30:45" },
		});
	});
});
