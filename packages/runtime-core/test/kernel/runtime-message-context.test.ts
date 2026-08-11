import type { UserMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { reconcileRuntimeMessageEnvelopes } from "../../src/kernel/runtime-message-context.js";
import type { RuntimeMessageEnvelope } from "../../src/runtime-execution-observation.js";

describe("runtime message context", () => {
	it("retains an opaque identity when text has equivalent string and content-block representations", () => {
		const candidate = opaque(textBlocks("context", 1));

		expect(reconcileRuntimeMessageEnvelopes([text("context", 1)], [candidate])).toEqual([candidate]);
	});

	it("does not associate an identity with a message from a different timestamp", () => {
		const candidate = opaque(textBlocks("context", 1));

		expect(reconcileRuntimeMessageEnvelopes([text("context", 2)], [candidate])).toEqual([
			{ kind: "message", message: text("context", 2) },
		]);
	});
});

function opaque(modelMessage: UserMessage): RuntimeMessageEnvelope {
	return { kind: "opaque", identity: { role: "custom" }, modelMessage, timestamp: modelMessage.timestamp };
}

function text(content: string, timestamp: number): UserMessage {
	return { role: "user", content, timestamp };
}

function textBlocks(content: string, timestamp: number): UserMessage {
	return { role: "user", content: [{ type: "text", text: content }], timestamp };
}
