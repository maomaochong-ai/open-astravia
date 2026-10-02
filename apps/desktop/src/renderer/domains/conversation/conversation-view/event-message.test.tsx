// @vitest-environment jsdom

import type { ChatConversationItem } from "@shared/store/chat-atoms";
import { cleanup, render, screen } from "@testing-library/react";
import { atom } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventMessage } from "./event-message";
import { ConversationFeedContext, createConversationFeed } from "./feed";
import { ConversationMessageScope } from "./message-scope";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const delegation: ChatConversationItem = {
	id: "event-1",
	kind: "event",
	event: { kind: "delegation", label: "Delegated to reviewer", requestId: "r1", timestamp: 1 },
} as ChatConversationItem;

function Row({ children }: { readonly children: ReactNode }) {
	const feed = createConversationFeed({
		key: "conversation",
		items: atom<readonly ChatConversationItem[]>([delegation]),
		workspace: { id: "/repo", cwd: "/repo", runtimeIds: [] },
	});
	return (
		<ConversationFeedContext.Provider value={feed}>
			<ConversationMessageScope row={{ message: delegation, index: 0, isTail: true, isLastUserMessage: false }}>
				{children}
			</ConversationMessageScope>
		</ConversationFeedContext.Provider>
	);
}

afterEach(cleanup);

describe("EventMessage parts", () => {
	it("renders an event only through the part of its kind", () => {
		const { rerender } = render(
			<Row>
				<EventMessage.Root>
					<EventMessage.Compaction />
					<EventMessage.Delegation />
				</EventMessage.Root>
			</Row>,
		);
		expect(screen.getByText("Delegated to reviewer")).toBeTruthy();

		rerender(
			<Row>
				<EventMessage.Root>
					<EventMessage.Compaction />
				</EventMessage.Root>
			</Row>,
		);
		expect(screen.queryByText("Delegated to reviewer")).toBeNull();
	});
});
