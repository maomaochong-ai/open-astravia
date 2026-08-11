import type { ConversationDocument, RuntimeMessageEnvelope } from "@vetta/runtime-core";
import type { ConversationContextProjector } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import { CodingAgentConversationContextOverlay } from "../../src/sessions/projection/conversation-context-overlay.js";

describe("CodingAgentConversationContextOverlay", () => {
	it("replaces the persisted fork seed while retaining messages appended in the target session", () => {
		const projected = new Map<string, readonly RuntimeMessageEnvelope[]>([
			["source", messages("source-1", "source-2")],
			["target", messages("seed")],
		]);
		const overlay = createOverlay(projected);
		overlay.preserve("target", projected.get("source") ?? [], projected.get("target") ?? []);

		projected.set("target", messages("seed", "target-new"));

		expect(readTexts(overlay.project(document("target")))).toEqual(["source-1", "source-2", "target-new"]);
	});

	it("drops the transient override when the persisted branch no longer starts with the fork seed", () => {
		const projected = new Map<string, readonly RuntimeMessageEnvelope[]>([["target", messages("seed")]]);
		const overlay = createOverlay(projected);
		overlay.preserve("target", messages("source"), messages("seed"));

		projected.set("target", messages("different-branch"));
		expect(readTexts(overlay.project(document("target")))).toEqual(["different-branch"]);

		projected.set("target", messages("seed", "later"));
		expect(readTexts(overlay.project(document("target")))).toEqual(["seed", "later"]);
	});
});

function createOverlay(projected: ReadonlyMap<string, readonly RuntimeMessageEnvelope[]>) {
	const delegate: ConversationContextProjector = {
		project: (value) => projected.get(value.identity.sessionId) ?? [],
	};
	return new CodingAgentConversationContextOverlay(delegate);
}

function document(sessionId: string): ConversationDocument {
	return {
		identity: { sessionId, createdAt: 1, cwd: "C:/workspace" },
		journalVersion: 0,
		revision: 0,
		activeLeafId: null,
		entries: [],
	};
}

function messages(...texts: string[]): readonly RuntimeMessageEnvelope[] {
	return texts.map((text) => ({
		kind: "message" as const,
		message: { role: "user" as const, content: [{ type: "text" as const, text }], timestamp: 1 },
	}));
}

function readTexts(values: readonly RuntimeMessageEnvelope[]): string[] {
	return values.flatMap((value) => {
		if (value.kind !== "message" || !Array.isArray(value.message.content)) return [];
		return value.message.content.flatMap((content) => (content.type === "text" ? [content.text] : []));
	});
}
