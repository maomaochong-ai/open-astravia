import { ConversationOwnershipConflictError } from "@vetta/runtime-storage";
import { describe, expect, it } from "vitest";
import { mapRuntimeHostSessionCreationError } from "../../src/composition/greenfield-runtime-host-session-backend.js";

describe("Greenfield RuntimeHost session errors", () => {
	it("maps storage ownership conflicts to the stable Runtime session-lock code", () => {
		const mapped = mapRuntimeHostSessionCreationError(
			new ConversationOwnershipConflictError(
				"C:/sessions/example.conversation.jsonl",
				"C:/sessions/example.conversation.jsonl.owner.lock",
				undefined,
			),
		);

		expect(mapped).toMatchObject({
			code: "SESSION_LOCKED",
			retryable: false,
			origin: "runtime",
		});
	});

	it("preserves unrelated creation failures", () => {
		const original = new Error("unrelated");
		expect(mapRuntimeHostSessionCreationError(original)).toBe(original);
	});
});
