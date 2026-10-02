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

	it("keeps composable conversation parts free of global session state", () => {
		expect(
			findConversationMessageArchitectureViolations([
				{
					path: "apps/desktop/src/renderer/domains/conversation/conversation-view/parts.tsx",
					text: [
						'import type { ChatConversationItem } from "@shared/store/chat-atoms";',
						'import { activeSessionAtom } from "@shared/store/atoms";',
						"openSessionFnRef.current?.(cwd);",
					].join("\n"),
				},
				{
					path: "apps/desktop/src/renderer/domains/conversation/conversation-view/parts.test.tsx",
					text: 'import { activeSessionAtom } from "@shared/store/atoms";',
				},
			]),
		).toEqual([
			"apps/desktop/src/renderer/domains/conversation/conversation-view/parts.tsx:2: composable conversation parts take data and capabilities from the feed, not global state (ADR-0147)",
			"apps/desktop/src/renderer/domains/conversation/conversation-view/parts.tsx:3: composable conversation parts take data and capabilities from the feed, not global state (ADR-0147)",
		]);
	});

	it("routes message list writes through the conversation feed reducer", () => {
		expect(
			findConversationMessageArchitectureViolations([
				{
					path: "apps/desktop/src/renderer/domains/example.ts",
					text: [
						"const messages = useAtomValue(chatMessagesAtom);",
						"const setMessages = useSetAtom(chatMessagesAtom);",
						"store.set(chatMessagesAtom, []);",
					].join("\n"),
				},
				{
					path: "apps/desktop/src/renderer/domains/example.test.ts",
					text: "store.set(chatMessagesAtom, []);",
				},
			]),
		).toEqual([
			"apps/desktop/src/renderer/domains/example.ts:2: write the message list through dispatchConversationFeed, not chatMessagesAtom (ADR-0146)",
			"apps/desktop/src/renderer/domains/example.ts:3: write the message list through dispatchConversationFeed, not chatMessagesAtom (ADR-0146)",
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

	it("keeps the active session out of shared message rendering", () => {
		expect(
			findConversationMessageArchitectureViolations([
				{
					path: "apps/desktop/src/renderer/domains/conversation/components/message-list/Banner.tsx",
					text: ["const session = useAtomValue(activeSessionAtom);", 'openSessionFnRef.current?.("/a");'].join(
						"\n",
					),
				},
				{
					path: "apps/desktop/src/renderer/domains/conversation/session-conversation/Banner.tsx",
					text: "const session = useAtomValue(activeSessionAtom);",
				},
			]),
		).toEqual([
			"apps/desktop/src/renderer/domains/conversation/components/message-list/Banner.tsx:1: shared message rendering serves every feed; session-only parts belong in session-conversation (ADR-0147)",
			"apps/desktop/src/renderer/domains/conversation/components/message-list/Banner.tsx:2: shared message rendering serves every feed; session-only parts belong in session-conversation (ADR-0147)",
		]);
	});
});
