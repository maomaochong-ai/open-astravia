import type { ContentBlock, ConversationAgentMessageViewModel } from "@shared/conversation";
import { resolvePluginIconNode } from "@shared/lib/plugin-icon";
import { pluginCardRenderersAtom, type RegisteredCardRenderer } from "@shared/store/atoms";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import type { CardDescriptor, PluginCardProps } from "@vetta-org/plugin-sdk";
import { useAtomValue } from "jotai";
import type { ComponentType, ReactNode } from "react";
import { createContext, createElement, useContext, useMemo, useRef } from "react";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import type { ResolvedCard } from "../components/MessageCards";

/** A card descriptor with its anchoring message and in-flight flag. */
export interface RawCard {
	descriptor: CardDescriptor;
	pending: boolean;
	anchorId: string;
}

type PendingDescriptorCache = Map<string, Map<RegisteredCardRenderer, CardDescriptor>>;
interface CardScope {
	cache: PendingDescriptorCache;
	owners: Map<string, string>;
}
const CardScopeContext = createContext<CardScope | null>(null);

/** Cache ownership follows the feed, never the globally active conversation. */
export function MessageCardsScope({
	messages,
	scope,
	children,
}: {
	messages: readonly ChatConversationItem[];
	scope: string | null;
	children: ReactNode;
}) {
	const renderers = useAtomValue(pluginCardRenderersAtom);
	const state = useMemo(
		() => ({
			scope,
			cache: new Map<string, Map<RegisteredCardRenderer, CardDescriptor>>(),
			owners: new Map<string, string>(),
		}),
		[scope],
	);
	const owners = useMemo(() => {
		const owners = new Map<string, string>();
		for (const message of messages) {
			if (message.kind !== "agent") continue;
			for (const card of cardsForMessage(message, renderers, state.cache)) {
				if (card.descriptor.key) owners.set(card.descriptor.key, message.id);
			}
		}
		collectPendingDescriptorCache(messages, state.cache);
		if (!sameOwnerMap(state.owners, owners)) state.owners = owners;
		return state.owners;
	}, [messages, renderers, state]);
	const value = useMemo(() => ({ cache: state.cache, owners }), [state, owners]);
	return createElement(CardScopeContext.Provider, { value }, children);
}

/**
 * Cards a single message contributes, in display order:
 *  - settled — each tool_call block's `cards` (from its result's details.cards).
 *  - pending — for each in-flight tool_call, every renderer's `pendingFor` gets
 *    a shot at synthesizing a provisional descriptor.
 */
function cardsForMessage(
	message: ConversationAgentMessageViewModel,
	renderers: RegisteredCardRenderer[],
	pendingDescriptorCache: PendingDescriptorCache,
): RawCard[] {
	const blocks: ContentBlock[] = message.blocks;
	const cards: RawCard[] = [];
	for (const block of blocks) {
		if (block.type !== "tool_call") continue;
		if (block.status === "pending") {
			const toolCall = { toolName: block.toolName, args: block.args ?? {} };
			let sticky = pendingDescriptorCache.get(block.toolCallId);
			for (const renderer of renderers) {
				const remembered = sticky?.get(renderer);
				if (remembered) {
					cards.push({ descriptor: remembered, pending: true, anchorId: message.id });
					continue;
				}
				const descriptor = renderer.pendingFor?.(toolCall);
				if (!descriptor) continue;
				if (!sticky) {
					sticky = new Map();
					pendingDescriptorCache.set(block.toolCallId, sticky);
				}
				sticky.set(renderer, descriptor);
				cards.push({ descriptor, pending: true, anchorId: message.id });
			}
		} else {
			// 落定后骨架位交给真实卡片，记忆不再需要（同一 toolCallId 不会再回到 pending）。
			pendingDescriptorCache.delete(block.toolCallId);
			if (block.cards) {
				for (const descriptor of block.cards) cards.push({ descriptor, pending: false, anchorId: message.id });
			}
		}
	}
	return cards;
}

/** 丢掉已经不在消息列表里、或已不再处于 pending 的 tool call 记忆。 */
function collectPendingDescriptorCache(
	messages: readonly ChatConversationItem[],
	pendingDescriptorCache: PendingDescriptorCache,
): void {
	if (pendingDescriptorCache.size === 0) return;
	const live = new Set<string>();
	for (const message of messages) {
		if (message.kind !== "agent") continue;
		for (const block of message.blocks) {
			if (block.type === "tool_call" && block.status === "pending") live.add(block.toolCallId);
		}
	}
	for (const toolCallId of pendingDescriptorCache.keys()) {
		if (!live.has(toolCallId)) pendingDescriptorCache.delete(toolCallId);
	}
}

/** 只比较「key → 归属消息」这层内容，用来判断派生结果能否复用旧引用。 */
function sameOwnerMap(a: Map<string, string>, b: Map<string, string>): boolean {
	if (a === b) return true;
	if (a.size !== b.size) return false;
	for (const [key, owner] of a) {
		if (b.get(key) !== owner) return false;
	}
	return true;
}

export interface MessageCardsHostModel {
	cards: ResolvedCard[];
	convMessage: { id: string; role: "assistant"; text: string; timestamp?: number };
}

/** 同一条消息产出的原始卡片列表是否等价（descriptor 身份已由缓存固定）。 */
function sameRawCards(a: RawCard[], b: RawCard[]): boolean {
	if (a.length !== b.length) return false;
	for (let index = 0; index < a.length; index++) {
		const left = a[index] as RawCard;
		const right = b[index] as RawCard;
		if (left.descriptor !== right.descriptor || left.pending !== right.pending || left.anchorId !== right.anchorId) {
			return false;
		}
	}
	return true;
}

/**
 * 本条消息自己产出的原始卡片。只依赖这条消息与 renderer 注册表，绝大多数消息在这里
 * 就返回空数组并短路掉后面的全局订阅。
 *
 * 流式期间尾部消息每 token 换引用，但它产出的卡片通常一模一样；内容等价时复用旧数组，
 * 让下游 memo 真正命中。
 */
export function useMessageRawCards(message: ConversationAgentMessageViewModel): {
	rawCards: RawCard[];
	renderers: RegisteredCardRenderer[];
} {
	const renderers = useAtomValue(pluginCardRenderersAtom);
	const scope = useContext(CardScopeContext);
	const localCache = useRef<PendingDescriptorCache>(new Map());
	const cache = scope?.cache ?? localCache.current;
	const stableRef = useRef<RawCard[]>([]);
	const rawCards = useMemo(() => {
		const next = cardsForMessage(message, renderers, cache);
		if (sameRawCards(stableRef.current, next)) return stableRef.current;
		stableRef.current = next;
		return next;
	}, [message, renderers, cache]);
	return { rawCards, renderers };
}

export function useMessageCardsHostModel(
	message: ConversationAgentMessageViewModel,
	rawCards: RawCard[],
	renderers: RegisteredCardRenderer[],
): MessageCardsHostModel | null {
	const latestOwnerByKey = useContext(CardScopeContext)?.owners;
	const trPlugin = usePluginTextResolver();

	const rendererByType = useMemo<Map<string, RegisteredCardRenderer>>(() => {
		const map = new Map<string, RegisteredCardRenderer>();
		for (const renderer of renderers) map.set(renderer.type, renderer);
		return map;
	}, [renderers]);

	const cards = useMemo<ResolvedCard[]>(() => {
		const owned = rawCards.filter(
			(c) => !c.descriptor.key || !latestOwnerByKey || latestOwnerByKey.get(c.descriptor.key) === message.id,
		);
		const lastIndexByKey = new Map<string, number>();
		owned.forEach((c, i) => {
			if (c.descriptor.key) lastIndexByKey.set(c.descriptor.key, i);
		});
		const resolved: ResolvedCard[] = [];
		owned.forEach((c, i) => {
			if (c.descriptor.key && lastIndexByKey.get(c.descriptor.key) !== i) return;
			const renderer = rendererByType.get(c.descriptor.type);
			if (!renderer) return;
			const rawTitle = c.descriptor.title ?? renderer.title;
			resolved.push({
				id: `${c.anchorId}:${c.descriptor.type}:${c.descriptor.key ?? i}`,
				pluginId: renderer.pluginId,
				descriptor: c.descriptor,
				pending: c.pending,
				Component: renderer.component as ComponentType<PluginCardProps>,
				title: rawTitle ? trPlugin(renderer.pluginId, rawTitle) : renderer.pluginId,
				icon: resolvePluginIconNode(c.descriptor.icon) ?? (renderer.icon as ReactNode),
			});
		});
		return resolved;
	}, [message.id, rawCards, rendererByType, latestOwnerByKey, trPlugin]);

	const convMessage = useMemo(
		() => ({ id: message.id, role: message.role, text: message.text ?? "", timestamp: message.timestamp }),
		[message.id, message.role, message.text, message.timestamp],
	);

	if (cards.length === 0) return null;

	return { cards, convMessage };
}
