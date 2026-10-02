// @vitest-environment jsdom

import { createConversationAgentMessage, createConversationUserMessage } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import { cleanup, render, screen } from "@testing-library/react";
import { atom } from "jotai";
import { Fragment, type ReactNode, useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageListModel } from "../components/message-list/types";
import { ConversationExtensionRegistry, useConversationExtension, useConversationExtensionValue } from "./extensions";
import { ConversationFeedContext, createConversationFeed, useConversationCapability } from "./feed";
import { useMessage, useMessageRow } from "./message-scope";
import { ConversationMessages } from "./parts";
import { AgentMessageTemplate, UserMessageTemplate } from "./templates";
import { ConversationViewportFrame } from "./viewport-frame";

const renders = vi.hoisted(() => ({ userBubble: 0 }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock("@vetta-org/theme-ui/chat", () => ({
	MessageFeed: {
		Root: ({ children }: { children: ReactNode }) => <>{children}</>,
		VirtualList: (props: {
			items: ChatConversationItem[];
			getKey: (item: ChatConversationItem) => string;
			children: (item: ChatConversationItem, index: number) => ReactNode;
		}) => (
			<div>
				{props.items.map((item, index) => (
					<Fragment key={props.getKey(item)}>{props.children(item, index)}</Fragment>
				))}
			</div>
		),
		Footer: ({ children }: { children: ReactNode }) => <>{children}</>,
	},
	MessageFeedLayout: {
		Frame: ({ children }: { children: ReactNode }) => <>{children}</>,
		Viewport: ({ children }: { children: ReactNode }) => <>{children}</>,
		Virtualizer: ({ children }: { children: ReactNode }) => <>{children}</>,
	},
}));

vi.mock("../components/message-list/MessageItem", () => ({ ModelSwitchBoundary: () => null }));
vi.mock("./defaults", async () => {
	const { useMessage } = await import("./message-scope");
	function DefaultRow() {
		return <div data-testid="default-item">{useMessage().id}</div>;
	}
	return { DefaultUserMessage: DefaultRow, DefaultAgentMessage: DefaultRow, DefaultEventMessage: DefaultRow };
});

const messages: ChatConversationItem[] = [
	createConversationUserMessage({ id: "u1", text: "question" }),
	createConversationAgentMessage({ id: "a1", text: "answer", blocks: [] }),
];

function model(items: readonly ChatConversationItem[] = messages): MessageListModel & {
	feedKey: string;
	deferredContentReady: boolean;
} {
	return {
		isStreaming: false,
		messages: items,
		modelSwitchLabels: new Map(),
		scroll: {
			virtuosoRef: { current: null },
			scrollerRef: vi.fn(),
			onAtBottomChange: vi.fn(),
			onTotalListHeightChange: vi.fn(),
			scrollToBottom: vi.fn(),
			scrollToMessage: vi.fn(),
			showScrollToBottom: false,
			followOutput: "auto",
			initialTopMostItemIndex: 0,
		} as never,
		tailMessageId: items.at(-1)?.id ?? null,
		participantsById: new Map(),
		participants: [],
		feedKey: "conversation-1",
		deferredContentReady: true,
	};
}

function UserBubble() {
	const message = useMessage();
	renders.userBubble += 1;
	return <div data-testid="user-bubble">{message.kind === "user" ? message.text : ""}</div>;
}

function TailMarker() {
	const { isTail } = useMessageRow();
	return isTail ? <span data-testid="tail-marker" /> : null;
}

function View({ children, items }: { readonly children?: ReactNode; readonly items?: ChatConversationItem[] }) {
	const viewModel = useMemo(() => model(items), [items]);
	return (
		<ConversationExtensionRegistry>
			<ConversationViewportFrame model={viewModel}>{children}</ConversationViewportFrame>
		</ConversationExtensionRegistry>
	);
}

afterEach(() => {
	cleanup();
	renders.userBubble = 0;
});

describe("Conversation.Messages templates", () => {
	it("renders each kind from its template and falls back to the read-only default for the rest", () => {
		render(
			<View>
				<ConversationMessages>
					<UserMessageTemplate>
						<UserBubble />
					</UserMessageTemplate>
				</ConversationMessages>
			</View>,
		);

		expect(screen.getByTestId("user-bubble").textContent).toBe("question");
		expect(screen.getByTestId("default-item").textContent).toBe("a1");
	});

	it("gives template parts the row they are rendered for", () => {
		render(
			<View>
				<ConversationMessages>
					<UserMessageTemplate>
						<TailMarker />
					</UserMessageTemplate>
					<AgentMessageTemplate>
						<TailMarker />
					</AgentMessageTemplate>
				</ConversationMessages>
			</View>,
		);

		expect(screen.getAllByTestId("tail-marker")).toHaveLength(1);
	});

	it("keeps unchanged rows when the composition re-renders with an equivalent template", () => {
		const items = [...messages];
		const composition = (
			<ConversationMessages>
				<UserMessageTemplate>
					<UserBubble />
				</UserMessageTemplate>
			</ConversationMessages>
		);
		const { rerender } = render(<View items={items}>{composition}</View>);
		const afterMount = renders.userBubble;

		// A new message streams in; the user row's message and template are unchanged.
		rerender(
			<View items={[...items, createConversationAgentMessage({ id: "a2", text: "more", blocks: [] })]}>
				<ConversationMessages>
					<UserMessageTemplate>
						<UserBubble />
					</UserMessageTemplate>
				</ConversationMessages>
			</View>,
		);

		expect(renders.userBubble).toBe(afterMount);
	});
});

describe("registered extensions", () => {
	function Highlight({ id }: { readonly id: string }) {
		const extension = useMemo(
			() => ({
				id,
				value: `${id}-value`,
				decorateRow: ({ message, children }: { message: ChatConversationItem; children: ReactNode }) => (
					<div data-testid={`${id}-${message.id}`}>{children}</div>
				),
			}),
			[id],
		);
		useConversationExtension(extension);
		return null;
	}

	function ValueProbe({ id }: { readonly id: string }) {
		return <span data-testid="value">{useConversationExtensionValue<string>(id) ?? "none"}</span>;
	}

	it("decorates every row while mounted and stops once removed", () => {
		const { rerender } = render(
			<View>
				<ConversationMessages />
				<Highlight id="highlight" />
				<ValueProbe id="highlight" />
			</View>,
		);
		expect(screen.getByTestId("highlight-u1")).toBeTruthy();
		expect(screen.getByTestId("highlight-a1")).toBeTruthy();
		expect(screen.getByTestId("value").textContent).toBe("highlight-value");

		rerender(
			<View>
				<ConversationMessages />
				<ValueProbe id="highlight" />
			</View>,
		);
		expect(screen.queryByTestId("highlight-u1")).toBeNull();
		expect(screen.getByTestId("value").textContent).toBe("none");
	});
});

describe("capabilities", () => {
	function StopButton() {
		const abort = useConversationCapability("abort");
		return abort ? <button type="button">stop</button> : null;
	}

	it("lets a part render only when its feed offers the capability", () => {
		const base = {
			key: "k",
			items: atom<readonly ChatConversationItem[]>([]),
			workspace: { id: "w", cwd: "/w" } as never,
		};
		const { rerender } = render(
			<ConversationFeedContext.Provider value={createConversationFeed(base)}>
				<StopButton />
			</ConversationFeedContext.Provider>,
		);
		expect(screen.queryByRole("button")).toBeNull();

		rerender(
			<ConversationFeedContext.Provider value={createConversationFeed({ ...base, capabilities: { abort: vi.fn() } })}>
				<StopButton />
			</ConversationFeedContext.Provider>,
		);
		expect(screen.getByRole("button", { name: "stop" })).toBeTruthy();
	});
});
