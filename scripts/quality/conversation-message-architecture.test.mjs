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

	it("rejects retired product message types, fake slots, and compaction roles", () => {
		expect(
			findConversationMessageArchitectureViolations([
				{
					path: "apps/desktop/src/renderer/example.ts",
					text: [
						"interface ChatMessage {}",
						"const Slot = createMessageSlot('Root');",
						"const value = { role: 'compaction' };",
					].join("\n"),
				},
			]),
		).toEqual([
			"apps/desktop/src/renderer/example.ts:1: retired message identifier ChatMessage",
			"apps/desktop/src/renderer/example.ts:2: createMessageSlot is forbidden; compose explicit primitives or a domain recipe",
			"apps/desktop/src/renderer/example.ts:3: compaction must be a timeline event, not a message role",
		]);
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

	it("rejects the retired synchronous Team delegation tool", () => {
		expect(
			findConversationMessageArchitectureViolations([
				{
					path: "apps/desktop/src/main/agent-teams/example.ts",
					text: 'const tool = { name: "team_delegate" };',
				},
			]),
		).toEqual(["apps/desktop/src/main/agent-teams/example.ts:1: retired synchronous Team tool team_delegate"]);
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
});
