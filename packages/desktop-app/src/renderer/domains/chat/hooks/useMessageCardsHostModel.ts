import { chatMessagesAtom, pluginCardRenderersAtom, type RegisteredCardRenderer } from "@shared/store/atoms";
import type { ChatMessage, ContentBlock } from "@shared/store/chat-atoms";
import type { CardDescriptor, PluginCardProps } from "@vetta-org/plugin-sdk";
import { atom, useAtomValue } from "jotai";
import type { ComponentType, ReactNode } from "react";
import { useMemo } from "react";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import type { ResolvedCard } from "../components/MessageCards";

/** A card descriptor with its anchoring message and in-flight flag. */
export interface RawCard {
	descriptor: CardDescriptor;
	pending: boolean;
	anchorId: string;
}

/**
 * Cards a single message contributes, in display order:
 *  - settled — each tool_call block's `cards` (from its result's details.cards).
 *  - pending — for each in-flight tool_call, every renderer's `pendingFor` gets
 *    a shot at synthesizing a provisional descriptor.
 */
function cardsForMessage(message: ChatMessage, renderers: RegisteredCardRenderer[]): RawCard[] {
	const blocks: ContentBlock[] = message.blocks ?? [];
	const cards: RawCard[] = [];
	for (const block of blocks) {
		if (block.type !== "tool_call") continue;
		if (block.status === "pending") {
			const toolCall = { toolName: block.toolName, args: block.args ?? {} };
			for (const renderer of renderers) {
				const descriptor = renderer.pendingFor?.(toolCall);
				if (descriptor) cards.push({ descriptor, pending: true, anchorId: message.id });
			}
		} else if (block.cards) {
			for (const descriptor of block.cards) cards.push({ descriptor, pending: false, anchorId: message.id });
		}
	}
	return cards;
}

/**
 * 同一个 card key 的归属：最后产出它的那条消息。
 *
 * 这本来是每条 assistant 消息各自算一遍的（全量消息 × 全量 block × 全量 renderer），
 * 于是整条列表退化成 O(N²)；流式期间消息数组每帧换引用，这个平方级扫描每帧重跑。
 * 提成派生 atom 后全局只算一次，且只有真的产出了卡片的消息才会订阅它。
 */
const latestCardOwnerByKeyAtom = atom((get) => {
	const messages = get(chatMessagesAtom);
	const renderers = get(pluginCardRenderersAtom);
	const owner = new Map<string, string>();
	for (const message of messages) {
		for (const card of cardsForMessage(message, renderers)) {
			if (card.descriptor.key) owner.set(card.descriptor.key, message.id);
		}
	}
	return owner;
});

export interface MessageCardsHostModel {
	cards: ResolvedCard[];
	convMessage: { id: string; role: ChatMessage["role"]; text: string; timestamp?: number };
}

/**
 * 本条消息自己产出的原始卡片。只依赖这条消息与 renderer 注册表，绝大多数消息在这里
 * 就返回空数组并短路掉后面的全局订阅。
 */
export function useMessageRawCards(message: ChatMessage): {
	rawCards: RawCard[];
	renderers: RegisteredCardRenderer[];
} {
	const renderers = useAtomValue(pluginCardRenderersAtom);
	const rawCards = useMemo(() => cardsForMessage(message, renderers), [message, renderers]);
	return { rawCards, renderers };
}

export function useMessageCardsHostModel(
	message: ChatMessage,
	rawCards: RawCard[],
	renderers: RegisteredCardRenderer[],
): MessageCardsHostModel | null {
	const latestOwnerByKey = useAtomValue(latestCardOwnerByKeyAtom);
	const trPlugin = usePluginTextResolver();

	const rendererByType = useMemo<Map<string, RegisteredCardRenderer>>(() => {
		const map = new Map<string, RegisteredCardRenderer>();
		for (const renderer of renderers) map.set(renderer.type, renderer);
		return map;
	}, [renderers]);

	const cards = useMemo<ResolvedCard[]>(() => {
		const owned = rawCards.filter((c) => !c.descriptor.key || latestOwnerByKey.get(c.descriptor.key) === message.id);
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
				icon: renderer.icon as ReactNode,
			});
		});
		return resolved;
	}, [message.id, rawCards, rendererByType, latestOwnerByKey, trPlugin]);

	if (cards.length === 0) return null;

	return {
		cards,
		convMessage: { id: message.id, role: message.role, text: message.text, timestamp: message.timestamp },
	};
}
