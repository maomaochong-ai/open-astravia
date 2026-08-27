import { ConversationOwnershipConflictError } from "@vetta/runtime-storage";
import { describe, expect, it } from "vitest";
import { mapCodingAgentRuntimeSessionCreationError } from "../../src/composition/runtime-host-retry.js";

describe("Coding Agent RuntimeHost session errors", () => {
	it("maps storage ownership conflicts to the stable Runtime session-lock code", () => {
		const mapped = mapCodingAgentRuntimeSessionCreationError(
			new ConversationOwnershipConflictError(
				"C:/sessions/example.conversation.jsonl",
				"C:/sessions/example.conversation.jsonl.owner.lock",
				{
					token: "must-not-cross-boundary",
					pid: 42,
					hostname: "worker",
					acquiredAt: "2026-08-27T00:00:00.000Z",
				},
			),
		);

		expect(mapped).toMatchObject({
			code: "SESSION_LOCKED",
			retryable: false,
			origin: "runtime",
			details: {
				lockHolder: {
					pid: 42,
					hostname: "worker",
					openedAt: "2026-08-27T00:00:00.000Z",
				},
			},
		});
		expect(mapped).not.toHaveProperty("details.lockHolder.token");
	});

	it("preserves unrelated creation failures", () => {
		const original = new Error("unrelated");
		expect(mapCodingAgentRuntimeSessionCreationError(original)).toBe(original);
	});
});
