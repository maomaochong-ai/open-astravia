// @vitest-environment jsdom

import { createConversationAgentMessage } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import { cleanup, render, screen } from "@testing-library/react";
import { atom } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentMessage } from "./agent-message";
import { ConversationFeedContext, createConversationFeed } from "./feed";
import { ConversationMessageScope } from "./message-scope";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@shared/components/BotAvatar", () => ({ BotAvatar: () => null }));
vi.mock("../components/MessageCardsHost", () => ({ MessageCardsHost: () => null }));

const reply = createConversationAgentMessage({ id: "a1", text: "answer", blocks: [] });

function Row({
	predicting = false,
	streaming = false,
	pendingLabel,
	message = reply,
	children,
}: {
	readonly predicting?: boolean;
	readonly streaming?: boolean;
	readonly pendingLabel?: string;
	readonly message?: typeof reply;
	readonly children: ReactNode;
}) {
	const feed = createConversationFeed({
		key: "conversation",
		items: atom<readonly ChatConversationItem[]>([message]),
		predicting: atom(predicting),
		streaming: atom(streaming),
		workspace: { id: "/repo", cwd: "/repo", runtimeIds: [] },
		...(pendingLabel ? { pendingLabel } : {}),
	});
	return (
		<ConversationFeedContext.Provider value={feed}>
			<ConversationMessageScope row={{ message, index: 0, isTail: true, isLastUserMessage: false }}>
				{children}
			</ConversationMessageScope>
		</ConversationFeedContext.Provider>
	);
}

afterEach(cleanup);

describe("AgentMessage parts", () => {
	it("renders only the parts placed in the template", () => {
		const { rerender } = render(
			<Row>
				<AgentMessage.Root>
					<AgentMessage.Content />
					<AgentMessage.Actions>
						<AgentMessage.ActionBar>
							<AgentMessage.CopyAction />
						</AgentMessage.ActionBar>
					</AgentMessage.Actions>
				</AgentMessage.Root>
			</Row>,
		);
		expect(screen.getByText("answer")).toBeTruthy();
		expect(screen.getByRole("button", { name: "messageList.copyButton.copy" })).toBeTruthy();

		rerender(
			<Row>
				<AgentMessage.Root>
					<AgentMessage.Content />
				</AgentMessage.Root>
			</Row>,
		);
		expect(screen.getByText("answer")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "messageList.copyButton.copy" })).toBeNull();
	});

	it("labels only a reply that has produced no output with the feed's pending label", () => {
		const template = (
			<AgentMessage.Root>
				<AgentMessage.Header />
			</AgentMessage.Root>
		);
		const waiting = createConversationAgentMessage({ id: "a1", phase: "pending", text: "", blocks: [] });
		const { rerender } = render(
			<Row streaming pendingLabel="团队正在加载" message={waiting}>
				{template}
			</Row>,
		);
		expect(screen.getByText("团队正在加载")).toBeTruthy();

		const answering = createConversationAgentMessage({ id: "a1", phase: "streaming", text: "回答", blocks: [] });
		rerender(
			<Row streaming pendingLabel="团队正在加载" message={answering}>
				{template}
			</Row>,
		);
		expect(screen.queryByText("团队正在加载")).toBeNull();
	});

	it("shows the prediction status only when the feed is predicting", () => {
		const template = (
			<AgentMessage.Root>
				<AgentMessage.Actions>
					<AgentMessage.PredictingStatus />
				</AgentMessage.Actions>
			</AgentMessage.Root>
		);
		const { rerender } = render(<Row>{template}</Row>);
		expect(screen.queryByText("messageList.assistantMessage.predicting")).toBeNull();
		rerender(<Row predicting>{template}</Row>);
		expect(screen.getByText("messageList.assistantMessage.predicting")).toBeTruthy();
	});
});
