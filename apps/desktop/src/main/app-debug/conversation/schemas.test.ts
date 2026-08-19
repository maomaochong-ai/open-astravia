import { describe, expect, it } from "vitest";
import { compactConversationInputSchema } from "./schemas.js";

describe("conversation.compact input", () => {
	it("accepts a persistent session path and bounded custom instructions", () => {
		expect(
			compactConversationInputSchema.parse({
				sessionPath: " C:\\project\\session.jsonl ",
				executionMode: "sandbox",
				customInstructions: " preserve decisions ",
			}),
		).toEqual({
			sessionPath: "C:\\project\\session.jsonl",
			executionMode: "sandbox",
			customInstructions: "preserve decisions",
		});
	});

	it("rejects empty instructions and unknown fields", () => {
		expect(
			compactConversationInputSchema.safeParse({ sessionPath: "C:\\session.jsonl", customInstructions: " " })
				.success,
		).toBe(false);
		expect(
			compactConversationInputSchema.safeParse({ sessionPath: "C:\\session.jsonl", exposeInProduction: true })
				.success,
		).toBe(false);
	});
});
