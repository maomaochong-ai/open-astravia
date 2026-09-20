// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import { createConversationAgentMessage, type ConversationAgentMessageViewModel } from "@shared/conversation";
import type { CardDescriptor } from "@vetta-org/plugin-sdk";
import { createStore, Provider, useAtomValue } from "jotai";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// 真实实现是 useCallback 包住的稳定引用（plugin-i18n.tsx），mock 必须同样稳定，
// 否则会掩盖模型层的引用稳定性。
const trPlugin = (_pluginId: string, text: string): string => text;
vi.mock("../../plugins/runtime/plugin-i18n", () => ({
	usePluginTextResolver: () => trPlugin,
}));

import { chatMessagesAtom, pluginCardRenderersAtom, type RegisteredCardRenderer } from "@shared/store/atoms";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import { MessageCardsScope, useMessageCardsHostModel, useMessageRawCards } from "./useMessageCardsHostModel";

const CARD_TYPE = "test:card";

function descriptor(key: string): CardDescriptor {
	return { type: CARD_TYPE, key, title: key, payload: {} };
}

/** 一条带在途 tool call 的 assistant 消息；每次调用换引用，模拟流式重建。 */
function streamingMessage(text: string): ConversationAgentMessageViewModel {
	return createConversationAgentMessage({
		id: "m1",
		phase: "streaming",
		text,
		blocks: [
			{ type: "text", id: "blk-text", text },
			{
				type: "tool_call",
				toolCallId: "tc-1",
				toolName: "vetd_screenshot",
				args: { frame: "Hero" },
				status: "pending",
			},
		],
	});
}

function renderer(pendingFor: RegisteredCardRenderer["pendingFor"]): RegisteredCardRenderer {
	return {
		pluginId: "test-plugin",
		type: CARD_TYPE,
		component: () => null,
		title: "Card",
		pendingFor,
	};
}

function setup(renderers: RegisteredCardRenderer[], messages: ChatConversationItem[]) {
	const store = createStore();
	store.set(pluginCardRenderersAtom, renderers);
	store.set(chatMessagesAtom, messages);
	const Scope = ({ children }: { children: ReactNode }) => {
		const items = useAtomValue(chatMessagesAtom);
		return (
			<MessageCardsScope messages={items} scope="test-feed">
				{children}
			</MessageCardsScope>
		);
	};
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>
			<Scope>{children}</Scope>
		</Provider>
	);
	return { store, wrapper };
}

/** 走完 host 的两段式：先算本条消息的原始卡片，再解析成可渲染卡片。 */
function useHost(message: ConversationAgentMessageViewModel) {
	const { rawCards, renderers } = useMessageRawCards(message);
	const model = useMessageCardsHostModel(message, rawCards, renderers);
	return { rawCards, model };
}

describe("useMessageCardsHostModel", () => {
	it("isolates pending cards across feeds with overlapping tool IDs and refreshes replaced renderers", () => {
		const store = createStore();
		const registration = renderer(({ args }) => descriptor(String(args.frame)));
		store.set(pluginCardRenderersAtom, [registration]);
		const first = streamingMessage("a");
		const second = createConversationAgentMessage({
			...first,
			blocks: first.blocks.map((block) =>
				block.type === "tool_call" ? { ...block, args: { frame: "Other" } } : block,
			),
		});
		function Cards({ message }: { message: ConversationAgentMessageViewModel }) {
			const { model } = useHost(message);
			return (
				<div>
					{model?.cards.map((card) => (
						<span key={card.id}>{card.title}</span>
					))}
				</div>
			);
		}
		render(
			<Provider store={store}>
				<MessageCardsScope scope="one" messages={[first]}>
					<Cards message={first} />
				</MessageCardsScope>
				<MessageCardsScope scope="two" messages={[second]}>
					<Cards message={second} />
				</MessageCardsScope>
			</Provider>,
		);
		expect(screen.getByText("Hero")).toBeTruthy();
		expect(screen.getByText("Other")).toBeTruthy();
		act(() => store.set(pluginCardRenderersAtom, [renderer(() => descriptor("Replacement"))]));
		expect(screen.queryByText("Hero")).toBeNull();
		expect(screen.queryByText("Other")).toBeNull();
		expect(screen.getAllByText("Replacement")).toHaveLength(2);
	});

	it("在途 tool call 的骨架卡不因 pendingFor 中途返回 null 而消失", () => {
		// pendingFor 是插件回调，读插件自己的模块级状态；它在相邻两帧返回不同结果是常态。
		let ready = true;
		const renderers = [renderer(() => (ready ? descriptor("vetd#Hero") : null))];
		const first = streamingMessage("a");
		const { store, wrapper } = setup(renderers, [first]);

		const { result, rerender } = renderHook(
			({ message }: { message: ConversationAgentMessageViewModel }) => useHost(message),
			{
				initialProps: { message: first },
				wrapper,
			},
		);
		expect(result.current.model?.cards).toHaveLength(1);

		ready = false;
		const second = streamingMessage("ab");
		store.set(chatMessagesAtom, [second]);
		rerender({ message: second });

		expect(result.current.model?.cards).toHaveLength(1);
	});

	it("流式重建消息但卡片内容不变时，rawCards 与 cards 复用旧引用", () => {
		const renderers = [renderer(() => descriptor("vetd#Hero"))];
		const first = streamingMessage("a");
		const { store, wrapper } = setup(renderers, [first]);

		const { result, rerender } = renderHook(
			({ message }: { message: ConversationAgentMessageViewModel }) => useHost(message),
			{
				initialProps: { message: first },
				wrapper,
			},
		);
		const rawBefore = result.current.rawCards;
		const cardsBefore = result.current.model?.cards;

		const second = streamingMessage("ab");
		store.set(chatMessagesAtom, [second]);
		rerender({ message: second });

		expect(result.current.rawCards).toBe(rawBefore);
		expect(result.current.model?.cards).toBe(cardsBefore);
	});

	it("同 key 的卡片仍然只挂在最后产出它的那条消息下", () => {
		const older = createConversationAgentMessage({
			id: "m0",
			text: "older",
			blocks: [
				{
					type: "tool_call",
					toolCallId: "tc-0",
					toolName: "vetd_screenshot",
					args: { frame: "Hero" },
					status: "success",
					cards: [descriptor("vetd#Hero")],
				},
			],
		});
		const renderers = [renderer(() => descriptor("vetd#Hero"))];
		const newer = streamingMessage("a");
		const { wrapper } = setup(renderers, [older, newer]);

		const olderHost = renderHook(() => useHost(older), { wrapper });
		const newerHost = renderHook(() => useHost(newer), { wrapper });

		expect(olderHost.result.current.model).toBeNull();
		expect(newerHost.result.current.model?.cards).toHaveLength(1);
	});

	it("tool call 落定后释放骨架记忆，改用结果里的真实卡片", () => {
		const renderers = [renderer(() => descriptor("vetd#Hero"))];
		const pending = streamingMessage("a");
		const { store, wrapper } = setup(renderers, [pending]);

		const { result, rerender } = renderHook(
			({ message }: { message: ConversationAgentMessageViewModel }) => useHost(message),
			{
				initialProps: { message: pending },
				wrapper,
			},
		);
		expect(result.current.model?.cards[0]?.pending).toBe(true);

		const settled: ConversationAgentMessageViewModel = {
			...pending,
			blocks: [
				{ type: "text", id: "blk-text", text: "a" },
				{
					type: "tool_call",
					toolCallId: "tc-1",
					toolName: "vetd_screenshot",
					args: { frame: "Hero" },
					status: "success",
					cards: [descriptor("vetd#Hero")],
				},
			],
		};
		store.set(chatMessagesAtom, [settled]);
		rerender({ message: settled });

		expect(result.current.model?.cards).toHaveLength(1);
		expect(result.current.model?.cards[0]?.pending).toBe(false);
	});

	it("卡片描述符的图标覆盖 renderer 默认图标", () => {
		const settled = createConversationAgentMessage({
			id: "m1",
			text: "done",
			blocks: [
				{
					type: "tool_call",
					toolCallId: "tc-1",
					toolName: "demo",
					args: {},
					status: "success",
					cards: [{ ...descriptor("result"), icon: "solar:star-bold" }],
				},
			],
		});
		const registration = {
			...renderer(() => null),
			icon: <span data-icon="renderer-default" />,
		};
		const { wrapper } = setup([registration], [settled]);
		const { result } = renderHook(() => useHost(settled), { wrapper });

		const icon = result.current.model?.cards[0]?.icon;
		expect(isValidElement(icon)).toBe(true);
		const element = icon as ReactElement<{ className?: string }>;
		expect(element.type).toBe("span");
		expect(element.props.className).toContain("icon-[solar--star-bold]");
	});
});
