import { chatMessagesAtom, pluginCardRenderersAtom, type RegisteredCardRenderer } from "@shared/store/atoms";
import type { ChatMessage, ContentBlock } from "@shared/store/chat-atoms";
import type { CardDescriptor, PluginCardProps } from "@vetta-org/plugin-sdk";
import { atom, useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import type { ComponentType, ReactNode } from "react";
import { useMemo, useRef } from "react";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import type { ResolvedCard } from "../components/MessageCards";

/** A card descriptor with its anchoring message and in-flight flag. */
export interface RawCard {
	descriptor: CardDescriptor;
	pending: boolean;
	anchorId: string;
}

/**
 * 已为某个在途 tool call 合成过的 pending descriptor，按 `toolCallId → rendererType` 记住。
 *
 * `pendingFor` 是插件回调，宿主每次重渲都会调它，而它并不受纯函数约束：
 * 常见写法会去读插件自己的模块级状态（当前画布 session 之类），于是同一个在途
 * tool call 在相邻两帧可能一帧返回 descriptor、一帧返回 null，或者返回 key 不同的
 * descriptor。宿主直接把这个返回值当渲染事实源，卡片就会在「有 / 没有」之间每帧翻转
 * ——卡片区高度随之在 0 与卡片高度之间来回跳，表现为流式期间整页持续抖动。
 *
 * 这里对同一个在途 tool call 只认第一次合成成功的结果，直到它落定为止：既固定了
 * descriptor 的对象身份（下游 memo 不再每帧失效），也让骨架位不会中途消失。
 */
const pendingDescriptorCache = new Map<string, Map<string, CardDescriptor>>();

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
			let sticky = pendingDescriptorCache.get(block.toolCallId);
			for (const renderer of renderers) {
				const remembered = sticky?.get(renderer.type);
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
				sticky.set(renderer.type, descriptor);
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
function collectPendingDescriptorCache(messages: readonly ChatMessage[]): void {
	if (pendingDescriptorCache.size === 0) return;
	const live = new Set<string>();
	for (const message of messages) {
		for (const block of message.blocks ?? []) {
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

/**
 * 同一个 card key 的归属：最后产出它的那条消息。
 *
 * 这本来是每条 assistant 消息各自算一遍的（全量消息 × 全量 block × 全量 renderer），
 * 于是整条列表退化成 O(N²)；流式期间消息数组每帧换引用，这个平方级扫描每帧重跑。
 * 提成派生 atom 后全局只算一次，且只有真的产出了卡片的消息才会订阅它。
 */
const rawCardOwnerByKeyAtom = atom((get) => {
	const messages = get(chatMessagesAtom);
	const renderers = get(pluginCardRenderersAtom);
	const owner = new Map<string, string>();
	for (const message of messages) {
		for (const card of cardsForMessage(message, renderers)) {
			if (card.descriptor.key) owner.set(card.descriptor.key, message.id);
		}
	}
	// 这里是唯一一处会看到全量消息的地方，顺带回收记忆：被中断/切走、永远等不到落定
	// 事件的 tool call 不会留在缓存里。
	collectPendingDescriptorCache(messages);
	return owner;
});

/**
 * 归属表在流式期间几乎从不变化，但上面那个 atom 每个 token 都会产出一张新 Map。
 * 不做引用稳定化的话，所有带卡片的消息每 token 都要重算 `cards`、重建 body 元素，
 * 把插件卡片整棵子树拖进每帧重渲。
 */
const latestCardOwnerByKeyAtom = selectAtom(rawCardOwnerByKeyAtom, (owner) => owner, sameOwnerMap);

export interface MessageCardsHostModel {
	cards: ResolvedCard[];
	convMessage: { id: string; role: ChatMessage["role"]; text: string; timestamp?: number };
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
export function useMessageRawCards(message: ChatMessage): {
	rawCards: RawCard[];
	renderers: RegisteredCardRenderer[];
} {
	const renderers = useAtomValue(pluginCardRenderersAtom);
	const stableRef = useRef<RawCard[]>([]);
	const rawCards = useMemo(() => {
		const next = cardsForMessage(message, renderers);
		if (sameRawCards(stableRef.current, next)) return stableRef.current;
		stableRef.current = next;
		return next;
	}, [message, renderers]);
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

	const convMessage = useMemo(
		() => ({ id: message.id, role: message.role, text: message.text, timestamp: message.timestamp }),
		[message.id, message.role, message.text, message.timestamp],
	);

	if (cards.length === 0) return null;

	return { cards, convMessage };
}

/** 测试专用：清掉在途 tool call 的 pending descriptor 记忆，隔离用例之间的状态。 */
export function resetPendingCardCacheForTests(): void {
	pendingDescriptorCache.clear();
}
