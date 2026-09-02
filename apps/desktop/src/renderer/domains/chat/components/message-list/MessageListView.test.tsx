// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, Fragment, type ReactNode } from "react";
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
	MessageFeed: {
		Root: ({ children }: { children: ReactNode }) => <>{children}</>,
		VirtualList: (props: Record<string, unknown>) => {
			captured.virtuosoProps = props;
			const data = props.items as Array<{ id: string }>;
			const children = Array.isArray(props.children) ? props.children : [props.children];
			const itemContent = children.find((child) => typeof child === "function") as (
				message: { id: string },
				index: number,
			) => JSX.Element;
			return (
				<div>
					{data.map((message, index) => (
						<Fragment key={message.id}>{itemContent(message, index)}</Fragment>
					))}
					{children.filter((child) => typeof child !== "function") as ReactNode[]}
				</div>
			);
		},
		Footer: ({ children }: { children: ReactNode }) => <>{children}</>,
	},
	MessageFeedLayout: {
		Frame: ({ children }: { children: ReactNode }) => <>{children}</>,
		Viewport: ({ children }: { children: ReactNode }) => <>{children}</>,
		Virtualizer: ({ children }: { children: ReactNode }) => <>{children}</>,
		List: () => null,
		LeftRail: ({ children }: { children: ReactNode }) => (
			<div className="pointer-events-none absolute top-1/2 left-3 z-20 -translate-y-1/2 @max-[52rem]:hidden">
				{children}
			</div>
		),
		RailContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	},
	MessageSelectionContextMenuView: () => null,
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
			waitingForResponse: false,
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
		cleanup();
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
		expect(captured.virtuosoProps?.itemsRendered).toEqual(expect.any(Function));
	});

	it("把提问目录悬浮在会话区域左侧，不占消息列宽度", () => {
		render(<MessageListView {...props("expanded")} />);
		const trigger = screen.getByRole("button", { name: "message timeline" });
		const host = trigger.closest(".absolute");
		expect(host?.className).toContain("left-3");
		expect(host?.className).not.toMatch(/\bright-/);
	});

	it("窄屏隐藏提问目录，避免压住右对齐气泡", () => {
		render(<MessageListView {...props("expanded")} />);
		const host = screen.getByRole("button", { name: "message timeline" }).closest(".absolute");
		expect(host?.className).toContain("@max-[52rem]:hidden");
	});
});
