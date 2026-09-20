// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { Usage } from "@vetta/ai";
import { createConversationAgentMessage } from "@shared/conversation";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, Fragment, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageListView } from "./MessageListView";

const captured = vi.hoisted(() => ({
	virtuosoProps: undefined as Record<string, unknown> | undefined,
	messageItemProps: [] as Array<Record<string, unknown>>,
}));

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

vi.mock("@vetta-org/theme-ui/chat", () => ({
	MessageFeed: {
		Root: ({ children }: { children: ReactNode }) => <>{children}</>,
		VirtualList: (props: Record<string, unknown>) => {
			captured.virtuosoProps = props;
			const data = props.items as Array<{ id: string; renderKey?: string }>;
			const getKey = props.getKey as (message: { id: string; renderKey?: string }) => string;
			const children = Array.isArray(props.children) ? props.children : [props.children];
			const itemContent = children.find((child) => typeof child === "function") as (
				message: { id: string; renderKey?: string },
				index: number,
			) => JSX.Element;
			return (
				<div>
					{data.map((message, index) => (
						<Fragment key={getKey(message)}>{itemContent(message, index)}</Fragment>
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
	MessageItem: (props: { message: { id: string }; pendingLabel?: string }) => {
		captured.messageItemProps.push(props as Record<string, unknown>);
		return (
			<div data-testid="full-message" data-pending-label={props.pendingLabel}>
				{props.message.id}
			</div>
		);
	},
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
	deferredContentReady: boolean,
	isStreaming = false,
	historyBufferEnabled = false,
): ComponentProps<typeof MessageListView> {
	const scrollToMessage = vi.fn();
	return {
		model: {
			isStreaming,
			messages: [createConversationAgentMessage({ id: "message-1", text: "full content", blocks: [] })],
			modelSwitchLabels: new Map(),
			scroll: {
				virtuosoRef: { current: null },
				scrollerRef: vi.fn(),
				onAtBottomChange: vi.fn(),
				onTotalListHeightChange: vi.fn(),
				scrollToMessage,
				followOutput: "auto",
				historyBufferEnabled,
				initialTopMostItemIndex: 0,
			} as never,
			tailMessageId: "message-1",
			participantsById: new Map(),
			participants: [],
		},
		onAbort: vi.fn(),
		sessionId: "/sessions/a.jsonl",
		deferredContentReady,
	};
}

describe("MessageListView history buffering", () => {
	beforeEach(() => {
		cleanup();
		captured.virtuosoProps = undefined;
		captured.messageItemProps = [];
	});

	it("非关键内容就绪不会扩张历史缓冲，用户开始浏览后才预渲染旧消息", () => {
		const { rerender } = render(<MessageListView {...props(false)} />);

		expect(screen.getByTestId("full-message").textContent).toBe("message-1");
		expect(captured.virtuosoProps?.overscan).toBe(0);
		expect(captured.virtuosoProps?.minOverscanItemCount).toEqual({ top: 0, bottom: 0 });
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 0, bottom: 0 });
		expect(captured.virtuosoProps?.followOutput).toBe("auto");
		expect(captured.virtuosoProps?.initialTopMostItemIndex).toBe(0);
		expect(captured.virtuosoProps?.totalListHeightChanged).toEqual(expect.any(Function));
		expect(screen.queryByRole("button", { name: "message timeline" })).toBeNull();

		rerender(<MessageListView {...props(true)} />);

		expect(captured.virtuosoProps?.overscan).toBe(0);
		expect(captured.virtuosoProps?.minOverscanItemCount).toEqual({ top: 0, bottom: 0 });
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 0, bottom: 0 });
		expect(screen.queryByRole("button", { name: "message timeline" })).not.toBeNull();

		rerender(<MessageListView {...props(true, false, true)} />);

		expect(screen.getByTestId("full-message").textContent).toBe("message-1");
		expect(captured.virtuosoProps?.overscan).toBe(400);
		expect(captured.virtuosoProps?.minOverscanItemCount).toEqual({ top: 12, bottom: 4 });
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 600, bottom: 200 });
	});

	it("恢复已测量位置时立即启用历史缓冲且不启用尾随", () => {
		const restoreStateFrom = { scrollTop: 320, ranges: [] };
		const initialBase = props(false, false, true);
		const initial = {
			...initialBase,
			model: {
				...initialBase.model,
				scroll: {
					...initialBase.model.scroll,
					followOutput: false,
					restoreStateFrom,
					initialTopMostItemIndex: undefined,
				},
			},
		};
		const { rerender } = render(<MessageListView {...initial} />);

		expect(screen.getByTestId("full-message").textContent).toBe("message-1");
		expect(captured.virtuosoProps?.followOutput).toBe(false);
		expect(captured.virtuosoProps?.restoreStateFrom).toEqual({ scrollTop: 320, ranges: [] });
		expect(captured.virtuosoProps?.initialTopMostItemIndex).toBeUndefined();
		expect(captured.virtuosoProps?.overscan).toBe(400);
		expect(captured.virtuosoProps?.minOverscanItemCount).toEqual({ top: 12, bottom: 4 });
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 600, bottom: 200 });

		const expandedBase = props(true, false, true);
		const expanded = {
			...expandedBase,
			model: {
				...expandedBase.model,
				scroll: {
					...expandedBase.model.scroll,
					followOutput: false,
					restoreStateFrom,
					initialTopMostItemIndex: undefined,
				},
			},
		};
		rerender(<MessageListView {...expanded} />);

		expect(captured.virtuosoProps?.initialTopMostItemIndex).toBeUndefined();
		expect(captured.virtuosoProps?.overscan).toBe(400);
		expect(captured.virtuosoProps?.minOverscanItemCount).toEqual({ top: 12, bottom: 4 });
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 600, bottom: 200 });
	});

	it("消息从乐观状态规范化为持久化状态时保留可见 DOM 行", () => {
		const initial = props(true, true);
		initial.model.messages = [
			{
				...createConversationAgentMessage({ id: "waiting-message", text: "", blocks: [] }),
				renderKey: "team:agent-turn:leader:request",
			},
		];
		const { rerender } = render(<MessageListView {...initial} />);
		const visibleRow = screen.getByTestId("full-message");

		const persisted = props(true);
		persisted.model.messages = [
			{
				...createConversationAgentMessage({ id: "persisted-message", text: "done", blocks: [] }),
				renderKey: "team:agent-turn:leader:request",
			},
		];
		rerender(<MessageListView {...persisted} />);

		expect(screen.getByTestId("full-message")).toBe(visibleRow);
		expect(visibleRow.textContent).toBe("persisted-message");
	});

	it("只把处理阶段文案传给尚未开始输出的待回复消息", () => {
		const waiting = props(true, true);
		waiting.pendingLabel = "团队正在加载";
		waiting.model.messages = [
			createConversationAgentMessage({ id: "waiting-message", phase: "pending", text: "", blocks: [] }),
		];
		const { rerender } = render(<MessageListView {...waiting} />);

		expect(screen.getByTestId("full-message").getAttribute("data-pending-label")).toBe("团队正在加载");

		const streaming = props(true, true);
		streaming.pendingLabel = "等待模型响应";
		streaming.model.messages = [
			createConversationAgentMessage({ id: "waiting-message", phase: "streaming", text: "回答", blocks: [] }),
		];
		rerender(<MessageListView {...streaming} />);

		expect(screen.getByTestId("full-message").getAttribute("data-pending-label")).toBeNull();
	});

	it("空会话仍使用零缓冲首屏，避免没有消息时预渲染无意义内容", () => {
		const viewProps = props(false);
		viewProps.model.messages = [];
		render(<MessageListView {...viewProps} />);

		expect(captured.virtuosoProps?.overscan).toBe(0);
		expect(captured.virtuosoProps?.minOverscanItemCount).toEqual({ top: 0, bottom: 0 });
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 0, bottom: 0 });
	});

	it("流式回复期间也为向上滚动保留历史消息缓冲", () => {
		render(<MessageListView {...props(true, true, true)} />);

		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 400, bottom: 80 });
		expect(captured.virtuosoProps?.minOverscanItemCount).toEqual({ top: 8, bottom: 2 });
	});

	it("把时间线的消息索引交给统一滚动模型", async () => {
		const viewProps = props(true);
		render(<MessageListView {...viewProps} />);

		await userEvent.click(screen.getByRole("button", { name: "message timeline" }));

		expect(viewProps.model.scroll.scrollToMessage).toHaveBeenCalledWith(3);
		expect(captured.virtuosoProps?.itemsRendered).toEqual(expect.any(Function));
	});

	it("把提问目录悬浮在会话区域左侧，不占消息列宽度", () => {
		render(<MessageListView {...props(true)} />);
		const trigger = screen.getByRole("button", { name: "message timeline" });
		const host = trigger.closest(".absolute");
		expect(host?.className).toContain("left-3");
		expect(host?.className).not.toMatch(/\bright-/);
	});

	it("窄屏隐藏提问目录，避免压住右对齐气泡", () => {
		render(<MessageListView {...props(true)} />);
		const host = screen.getByRole("button", { name: "message timeline" }).closest(".absolute");
		expect(host?.className).toContain("@max-[52rem]:hidden");
	});

	it("把所有历史助手消息的 usage 汇总后传给 Token 面板", () => {
		const firstUsage = usage({ input: 20, output: 10 });
		const secondUsage = usage({ input: 100, output: 70 });
		const viewProps = props(true);
		viewProps.model.messages = [
			createConversationAgentMessage({ id: "message-1", text: "first", blocks: [], usages: [firstUsage] }),
			createConversationAgentMessage({ id: "message-2", text: "second", blocks: [], usages: [secondUsage] }),
		];

		render(<MessageListView {...viewProps} />);

		expect(captured.messageItemProps).toHaveLength(2);
		expect(captured.messageItemProps[0].sessionUsages).toEqual([firstUsage, secondUsage]);
		expect(captured.messageItemProps[1].sessionUsages).toEqual([firstUsage, secondUsage]);
	});
});

function usage(overrides: Pick<Usage, "input" | "output">): Usage {
	return {
		input: overrides.input,
		output: overrides.output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: overrides.input + overrides.output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}
