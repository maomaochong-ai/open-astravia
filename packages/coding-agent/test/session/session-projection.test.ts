import type { UserMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import {
	type CodingAgentSessionEntry,
	projectCodingAgentSessionContext,
	projectCodingAgentSessionTree,
	readCodingAgentSessionLabels,
} from "../../src/sessions/index.js";

describe("Coding Agent session projections", () => {
	it("projects the selected branch and its effective model", () => {
		const entries: CodingAgentSessionEntry[] = [
			entry({ type: "model_change", id: "model", parentId: null, provider: "provider", modelId: "model-id" }),
			entry({ type: "message", id: "left", parentId: "model", message: userMessage("left") }),
			entry({ type: "message", id: "right", parentId: "model", message: userMessage("right") }),
			entry({ type: "label", id: "label", parentId: "right", targetId: "right", label: "chosen" }),
		];

		const context = projectCodingAgentSessionContext(entries, "right");
		expect(context.model).toEqual({ provider: "provider", modelId: "model-id" });
		expect(context.messages).toEqual([userMessage("right")]);

		const tree = projectCodingAgentSessionTree(entries, readCodingAgentSessionLabels(entries));
		expect(tree[0]?.children.map(({ entry: child }) => child.id)).toEqual(["left", "right"]);
		expect(tree[0]?.children[1]?.label).toBe("chosen");
	});

	it("projects a compaction summary followed by the kept tail", () => {
		const entries: CodingAgentSessionEntry[] = [
			entry({ type: "message", id: "old", parentId: null, message: userMessage("old") }),
			entry({ type: "message", id: "kept", parentId: "old", message: userMessage("kept") }),
			entry({ type: "message", id: "latest", parentId: "kept", message: userMessage("latest") }),
			entry({
				type: "compaction",
				id: "compaction",
				parentId: "latest",
				summary: "summary",
				firstKeptEntryId: "kept",
				tokensBefore: 42,
			}),
		];

		const messages = projectCodingAgentSessionContext(entries, "compaction").messages;
		expect(messages).toHaveLength(3);
		expect(messages.slice(1)).toEqual([userMessage("kept"), userMessage("latest")]);
	});
});

type SessionEntryInput = CodingAgentSessionEntry extends infer Entry
	? Entry extends CodingAgentSessionEntry
		? Omit<Entry, "timestamp"> & { readonly timestamp?: string }
		: never
	: never;

function entry(value: SessionEntryInput): CodingAgentSessionEntry {
	return { timestamp: "2026-01-01T00:00:00.000Z", ...value } as CodingAgentSessionEntry;
}

function userMessage(content: string): UserMessage {
	return { role: "user", content, timestamp: 1 };
}
