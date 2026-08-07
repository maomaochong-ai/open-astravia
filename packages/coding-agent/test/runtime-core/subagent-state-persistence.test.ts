import type {
	ConversationDocument,
	GreenfieldRuntimeCustomEntryInput,
	GreenfieldRuntimeDocumentParticipantContext,
} from "@vetta/runtime-core";
import type { SubagentRecoveryState, SubagentSnapshot } from "@vetta/runtime-subagents";
import { describe, expect, it, vi } from "vitest";
import {
	CODING_AGENT_SUBAGENT_STATE_CUSTOM_TYPE,
	CodingAgentSubagentStatePersistence,
} from "../../src/composition/subagent/state-persistence.js";

describe("CodingAgentSubagentStatePersistence", () => {
	it("folds versioned state events across the parent document and rejects invalid payloads locally", async () => {
		const restore = vi.fn<(state: SubagentRecoveryState) => void>();
		const onRecoveryIssue = vi.fn();
		const runtime = new CodingAgentSubagentStatePersistence({ restore, onRecoveryIssue });
		const context = recordingContext();
		const initial = snapshot("child-1", "completed");
		const document = conversationDocument([
			customEntry("state-1", {
				version: 1,
				event: "upsert",
				snapshot: initial,
			}),
			customEntry("delivery-1", {
				version: 1,
				event: "delivery_claimed",
				id: initial.id,
				generation: initial.generation,
			}),
			customEntry("invalid", {
				version: 2,
				event: "upsert",
				snapshot: initial,
			}),
		]);

		await runtime.initialize(document, context.value);

		expect(restore).toHaveBeenCalledWith({
			agents: [initial],
			delivered: [{ id: "child-1", generation: 1 }],
		});
		expect(onRecoveryIssue).toHaveBeenCalledOnce();
		expect(context.entries).toEqual([]);
		await runtime.dispose();
	});

	it("persists only changed agents, removals and new delivery claims", async () => {
		let sequence = 0;
		const initial = snapshot("child-1", "completed");
		const runtime = new CodingAgentSubagentStatePersistence({
			restore: () => {},
			createEntryId: () => `entry-${++sequence}`,
			now: () => 1,
		});
		const context = recordingContext();
		await runtime.initialize(
			conversationDocument([
				customEntry("state-1", {
					version: 1,
					event: "upsert",
					snapshot: initial,
				}),
			]),
			context.value,
		);

		runtime.recordSnapshots([initial]);
		runtime.recordSnapshots([{ ...initial, finalText: "updated" }]);
		runtime.recordDelivery({ id: "child-1", generation: 1 });
		runtime.recordDelivery({ id: "child-1", generation: 1 });
		runtime.recordSnapshots([]);
		await runtime.flush();

		expect(context.entries.map(({ data }) => data)).toEqual([
			{
				version: 1,
				event: "upsert",
				snapshot: { ...initial, finalText: "updated" },
			},
			{
				version: 1,
				event: "delivery_claimed",
				id: "child-1",
				generation: 1,
			},
			{
				version: 1,
				event: "remove",
				id: "child-1",
			},
		]);
		await runtime.dispose();
	});

	it("reasserts session-level state after an external document rewrite removes its entries", async () => {
		let sequence = 0;
		const initial = snapshot("child-1", "completed");
		const runtime = new CodingAgentSubagentStatePersistence({
			restore: () => {},
			createEntryId: () => `repair-${++sequence}`,
			now: () => 1,
		});
		const context = recordingContext();
		await runtime.initialize(
			conversationDocument([
				customEntry("state-1", {
					version: 1,
					event: "upsert",
					snapshot: initial,
				}),
				customEntry("delivery-1", {
					version: 1,
					event: "delivery_claimed",
					id: initial.id,
					generation: initial.generation,
				}),
			]),
			context.value,
		);

		await runtime.onDocumentChanged(conversationDocument([]));

		expect(context.entries.map(({ data }) => data)).toEqual([
			{
				version: 1,
				event: "upsert",
				snapshot: initial,
			},
			{
				version: 1,
				event: "delivery_claimed",
				id: initial.id,
				generation: initial.generation,
			},
		]);
		await runtime.dispose();
	});
});

function recordingContext(): {
	readonly entries: GreenfieldRuntimeCustomEntryInput[];
	readonly value: GreenfieldRuntimeDocumentParticipantContext;
} {
	const entries: GreenfieldRuntimeCustomEntryInput[] = [];
	return {
		entries,
		value: {
			async appendCustomEntry(entry) {
				entries.push(entry);
			},
		},
	};
}

function conversationDocument(entries: ConversationDocument["entries"]): ConversationDocument {
	return {
		identity: { sessionId: "root-session", createdAt: 1 },
		journalVersion: 0,
		revision: entries.length,
		entries,
		activeLeafId: null,
	};
}

function customEntry(id: string, data: unknown): ConversationDocument["entries"][number] {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: "2026-07-29T00:00:00.000Z",
		customType: CODING_AGENT_SUBAGENT_STATE_CUSTOM_TYPE,
		data,
	};
}

function snapshot(id: string, status: SubagentSnapshot["status"]): SubagentSnapshot {
	return {
		id,
		taskName: "inspect_repo",
		path: "/root/inspect_repo",
		agentType: "explorer",
		status,
		task: "Inspect repository",
		parentSessionId: "root-session",
		sessionFile: `C:\\sessions\\.subagents\\root-session\\${id}.conversation.jsonl`,
		startedAt: 1,
		endedAt: 2,
		finalText: "done",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costTotal: 0 },
		generation: 1,
	};
}
