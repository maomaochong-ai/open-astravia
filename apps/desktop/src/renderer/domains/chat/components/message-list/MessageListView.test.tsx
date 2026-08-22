// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, Fragment } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageListView } from "./MessageListView";

const captured = vi.hoisted(() => ({ virtuosoProps: undefined as Record<string, unknown> | undefined }));

vi.mock("react-virtuoso", () => ({
	Virtuoso: (props: Record<string, unknown>) => {
		captured.virtuosoProps = props;
		const data = props.data as Array<{ id: string }>;
		const itemContent = props.itemContent as (index: number, message: { id: string }) => JSX.Element;
		return (
			<div>
				{data.map((message, index) => (
					<Fragment key={message.id}>{itemContent(index, message)}</Fragment>
				))}
			</div>
		);
	},
}));

vi.mock("@vetta/theme-ui/chat", () => ({
	MessageListView: ({ virtuoso }: { virtuoso: JSX.Element }) => virtuoso,
	MessageSelectionContextMenuView: () => null,
	VirtuosoListContainer: ({ children }: { children?: JSX.Element }) => <div>{children}</div>,
}));

vi.mock("../../hooks/useMessageSelectionContextMenu", () => ({
	useMessageSelectionContextMenu: () => ({
		containerRef: { current: null },
		contextMenu: null,
		onContextMenuCapture: vi.fn(),
	}),
}));

vi.mock("../SuggestionBubbles", () => ({ SuggestionBubbles: () => null }));
vi.mock("./ForkOriginBanner", () => ({
	ForkOriginBanner: () => null,
	resolveForkOriginPlacement: () => null,
}));
vi.mock("./MessageItem", () => ({
	ExportMessageList: () => null,
	MessageItem: ({ message }: { message: { id: string } }) => (
		<div data-testid="full-message">{message.id}</div>
	),
	ModelSwitchBoundary: () => null,
}));
vi.mock("./MessageListFooter", () => ({ MessageListFooter: () => null }));
vi.mock("./MessageTimeline", () => ({
	MessageTimeline: ({ onNavigate }: { onNavigate: (index: number) => void }) => (
		<button type="button" onClick={() => onNavigate(3)}>
			message timeline
		</button>
	),
}));

function props(
	viewportPhase: "initial" | "expanded",
): ComponentProps<typeof MessageListView> {
	const scrollToMessage = vi.fn();
	return {
		model: {
			isCompacting: false,
			isStreaming: false,
			messages: [{ id: "message-1", role: "assistant", text: "full content" }],
			modelSwitchLabels: new Map(),
			scroll: {
				virtuosoRef: { current: null },
				scrollerRef: vi.fn(),
				onAtBottomChange: vi.fn(),
				scrollToMessage,
			} as never,
			showWaiting: false,
			tailMessageId: "message-1",
		},
		onAbort: vi.fn(),
		onSend: vi.fn(async () => {}),
		sessionId: "/sessions/a.jsonl",
		viewportPhase,
	};
}

describe("MessageListView viewport phases", () => {
	beforeEach(() => {
		captured.virtuosoProps = undefined;
	});

	it("首屏与扩大预渲染阶段都使用同一套完整消息组件", () => {
		const { rerender } = render(<MessageListView {...props("initial")} />);

		expect(screen.getByTestId("full-message").textContent).toBe("message-1");
		expect(captured.virtuosoProps?.overscan).toBe(0);
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 0, bottom: 0 });

		rerender(<MessageListView {...props("expanded")} />);

		expect(screen.getByTestId("full-message").textContent).toBe("message-1");
		expect(captured.virtuosoProps?.overscan).toBe(400);
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 200, bottom: 200 });
	});

	it("把时间线的消息索引交给统一滚动模型", async () => {
		const viewProps = props("expanded");
		render(<MessageListView {...viewProps} />);

		await userEvent.click(screen.getByRole("button", { name: "message timeline" }));

		expect(viewProps.model.scroll.scrollToMessage).toHaveBeenCalledWith(3);
		expect(captured.virtuosoProps?.rangeChanged).toEqual(expect.any(Function));
	});
});
