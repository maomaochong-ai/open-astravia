import { describe, expect, it } from "vitest";
import { findConversationMessageArchitectureViolations } from "./check-conversation-message-architecture.mjs";

describe("Conversation message architecture guard", () => {
	it("accepts ordinary messages, explicit primitives, and timeline events", () => {
		expect(
			findConversationMessageArchitectureViolations([
				{
					path: "apps/desktop/src/renderer/example.tsx",
					text: [
						"type Item = ConversationMessageViewModel | ConversationTimelineEventViewModel;",
						"const author: ConversationAgentAuthorReference = { kind: 'agent', id: 'reviewer' };",
						"const slot = <MessageBubble><MessageContent /></MessageBubble>;",
					].join("\n"),
				},
			]),
		).toEqual([]);
	});

	it("keeps compaction as a timeline event rather than a message role", () => {
		expect(
			findConversationMessageArchitectureViolations([
				{
					path: "apps/desktop/src/renderer/example.ts",
					text: "const value = { role: 'compaction' };",
				},
			]),
		).toEqual(["apps/desktop/src/renderer/example.ts:1: compaction must be a timeline event, not a message role"]);
	});

	it("does not confuse explicit legacy migration names with the retired current type", () => {
		expect(
			findConversationMessageArchitectureViolations([
				{
					path: "packages/agent-team/src/legacy-events.ts",
					text: "export type LegacyTeamFeedEvent = { type: 'user-message' };",
				},
			]),
		).toEqual([]);
	});

	it("keeps MessageFeed and Agent Team independent from product message and subagent domains", () => {
		expect(
			findConversationMessageArchitectureViolations([
				{
					path: "apps/desktop/src/renderer/shared/components/message-feed/example.ts",
					text: 'import type { ConversationMessageViewModel } from "@shared/conversation";',
				},
				{
					path: "packages/agent-team/src/example.ts",
					text: 'import { createSubagent } from "@vetta/runtime-subagents";',
				},
			]),
		).toEqual([
			"apps/desktop/src/renderer/shared/components/message-feed/example.ts: product-neutral MessageFeed imports a product or message domain",
			"packages/agent-team/src/example.ts: Agent Team must not depend on the private subagent runtime",
		]);
	});

	it("keeps Team conversations on the shared conversation recipe", () => {
		expect(
			findConversationMessageArchitectureViolations([
				{
					path: "apps/desktop/src/renderer/domains/conversation/connectors/team/TeamChatView.tsx",
					text: "return <ConversationEditorView />;",
				},
			]),
		).toEqual([
			"apps/desktop/src/renderer/domains/conversation/connectors/team/TeamChatView.tsx: Team connector must compose the shared conversation recipe",
		]);
	});
});
