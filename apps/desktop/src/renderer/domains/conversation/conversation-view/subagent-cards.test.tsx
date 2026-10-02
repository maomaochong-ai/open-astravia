// @vitest-environment jsdom

import type { ChatConversationItem } from "@shared/store/chat-atoms";
import { cleanup, render, screen } from "@testing-library/react";
import { atom } from "jotai";
import type { ReactNode } from "react";
import { afterEach, expect, it } from "vitest";
import { SubagentCardsScope, useSubagentCardsSession } from "../components/message-list/SubagentCardsScope";
import { ConversationExtensionRegistry } from "./extensions";
import { ConversationFeedContext, createConversationFeed } from "./feed";
import { SubagentCardsExtension } from "./subagent-cards";

function Probe() {
	return <span data-testid="runtime">{useSubagentCardsSession() ?? "none"}</span>;
}

function View({ runtimeId, children }: { readonly runtimeId?: string; readonly children: ReactNode }) {
	const feed = createConversationFeed({
		key: "conversation",
		items: atom<readonly ChatConversationItem[]>([]),
		workspace: { id: "/repo", cwd: "/repo", runtimeIds: [] },
		capabilities: runtimeId ? { subagentRuntimeId: runtimeId } : {},
	});
	return (
		<ConversationFeedContext.Provider value={feed}>
			<ConversationExtensionRegistry>{children}</ConversationExtensionRegistry>
		</ConversationFeedContext.Provider>
	);
}

afterEach(cleanup);

it("shows the feed's subagent cards only while the extension is mounted", () => {
	const { rerender } = render(
		<View runtimeId="runtime-a">
			<Probe />
			<SubagentCardsExtension />
		</View>,
	);
	expect(screen.getByTestId("runtime").textContent).toBe("runtime-a");

	rerender(
		<View runtimeId="runtime-a">
			<Probe />
		</View>,
	);
	expect(screen.getByTestId("runtime").textContent).toBe("none");
});

it("prefers an explicit scope and works outside a conversation", () => {
	render(
		<SubagentCardsScope sessionId="explicit">
			<Probe />
		</SubagentCardsScope>,
	);
	expect(screen.getByTestId("runtime").textContent).toBe("explicit");
});
