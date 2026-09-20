// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { Usage } from "@vetta/ai";
import { createConversationAgentMessage } from "@shared/conversation";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, Fragment, type ReactNode, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageListView } from "./MessageListView";

const captured = vi.hoisted(() => ({
	virtuosoProps: undefined as Record<string, unknown> | undefined,
	messageItemProps: [] as Array<Record<string, unknown>>,
	virtualListMounts: 0,
	virtualListUnmounts: 0,
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
			useEffect(() => {
				captured.virtualListMounts++;
				return () => {
					captured.virtualListUnmounts++;
				};
			}, []);
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

function props(deferredContentReady: boolean, isStreaming = false): ComponentProps<typeof MessageListView> {
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

describe("MessageListView virtualization", () => {
	beforeEach(() => {
		cleanup();
		captured.virtuosoProps = undefined;
		captured.messageItemProps = [];
		captured.virtualListMounts = 0;
		captured.virtualListUnmounts = 0;
	});

	it("非关键内容就绪不会在滚动期间改写虚拟列表布局参数", () => {
		const initial = props(false);
		const { rerender } = render(<MessageListView {...initial} />);

		expect(screen.getByTestId("full-message").textContent).toBe("message-1");
		expect(captured.virtuosoProps?.overscan).toBe(0);
		expect(captured.virtuosoProps?.minOverscanItemCount).toBeUndefined();
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 320, bottom: 80 });
		expect(captured.virtuosoProps?.heightEstimates).toEqual([expect.any(Number)]);
		expect(captured.virtuosoProps?.defaultItemHeight).toBeUndefined();
		expect(captured.virtuosoProps?.itemSize).toEqual(expect.any(Function));
		expect(captured.virtuosoProps?.followOutput).toBe("auto");
		expect(captured.virtuosoProps?.initialTopMostItemIndex).toBe(0);
		expect(captured.virtuosoProps?.totalListHeightChanged).toEqual(expect.any(Function));
		// 普通滚动始终保留真实消息；不能让 Virtuoso 用空白占位替换整屏内容。
		expect(captured.virtuosoProps?.scrollSeekConfiguration).toBeUndefined();
		expect(screen.queryByRole("button", { name: "message timeline" })).toBeNull();

		rerender(<MessageListView {...props(true)} />);

		expect(captured.virtuosoProps?.overscan).toBe(0);
		expect(captured.virtuosoProps?.minOverscanItemCount).toBeUndefined();
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 320, bottom: 80 });
		expect(captured.virtuosoProps?.scrollSeekConfiguration).toBeUndefined();
		expect(screen.queryByRole("button", { name: "message timeline" })).not.toBeNull();
	});

	it("缓存消息实测高度供同一会话后续渲染复用", () => {
		const viewProps = props(true);
		const { rerender } = render(<MessageListView {...viewProps} />);
		const itemSize = captured.virtuosoProps?.itemSize as (
			element: HTMLElement,
			field: "offsetHeight" | "offsetWidth",
		) => number;
		const element = document.createElement("div");
		element.dataset.itemIndex = "0";
		Object.defineProperty(element, "offsetHeight", { configurable: true, value: 460 });

		expect(itemSize(element, "offsetHeight")).toBe(460);

		rerender(<MessageListView {...props(true)} />);
		expect(captured.virtuosoProps?.heightEstimates).toEqual([460]);
	});

	it("真实会话切换会重建高度树，临时会话解析为持久路径时保持当前列表", () => {
		const pending = props(true);
		pending.sessionId = null;
		const { rerender } = render(<MessageListView {...pending} />);
		expect(captured.virtualListMounts).toBe(1);

		const resolved = props(true);
		rerender(<MessageListView {...resolved} />);
		expect(captured.virtualListMounts).toBe(1);
		expect(captured.virtualListUnmounts).toBe(0);

		const switched = props(true);
		switched.sessionId = "/sessions/b.jsonl";
		switched.model.messages = [
			createConversationAgentMessage({ id: "message-b", text: "other conversation", blocks: [] }),
		];
		rerender(<MessageListView {...switched} />);

		expect(captured.virtualListMounts).toBe(2);
		expect(captured.virtualListUnmounts).toBe(1);
	});

	it("恢复已测量位置时立即启用历史缓冲且不启用尾随", () => {
		const restoreStateFrom = { scrollTop: 320, ranges: [] };
		const initialBase = props(false);
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
		expect(captured.virtuosoProps?.overscan).toBe(0);
		expect(captured.virtuosoProps?.minOverscanItemCount).toBeUndefined();
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 320, bottom: 80 });

		const expandedBase = props(true);
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
		expect(captured.virtuosoProps?.overscan).toBe(0);
		expect(captured.virtuosoProps?.minOverscanItemCount).toBeUndefined();
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 320, bottom: 80 });
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

	it("空会话保留固定布局参数并提供空高度表", () => {
		const viewProps = props(false);
		viewProps.model.messages = [];
		render(<MessageListView {...viewProps} />);

		expect(captured.virtuosoProps?.overscan).toBe(0);
		expect(captured.virtuosoProps?.minOverscanItemCount).toBeUndefined();
		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 320, bottom: 80 });
		expect(captured.virtuosoProps?.heightEstimates).toEqual([]);
	});

	it("流式回复期间沿用同一套固定渲染窗口", () => {
		render(<MessageListView {...props(true, true)} />);

		expect(captured.virtuosoProps?.increaseViewportBy).toEqual({ top: 320, bottom: 80 });
		expect(captured.virtuosoProps?.minOverscanItemCount).toBeUndefined();
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
