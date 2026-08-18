import type { ChatMessage, RegisteredCardRenderer } from "@shared/store/atoms";
import { MessageCardsHostView } from "@vetta/theme-ui/chat";
import {
	type RawCard,
	useMessageCardsHostModel,
	useMessageRawCards,
} from "../hooks/useMessageCardsHostModel";
import { MessageCards } from "./MessageCards";

/**
 * Mounts the plugin card area beneath a single (assistant) message.
 *
 * 两段式：先只看这条消息自己有没有产出卡片——绝大多数消息没有，直接返回 null，
 * 不去订阅「全局 card key 归属表」。只有真的有卡片的消息才挂内层组件、订阅那张表。
 */
export function MessageCardsHost({ message }: { message: ChatMessage }): JSX.Element | null {
	const { rawCards, renderers } = useMessageRawCards(message);
	if (rawCards.length === 0) return null;
	return <ResolvedMessageCards message={message} rawCards={rawCards} renderers={renderers} />;
}

function ResolvedMessageCards({
	message,
	rawCards,
	renderers,
}: {
	message: ChatMessage;
	rawCards: RawCard[];
	renderers: RegisteredCardRenderer[];
}): JSX.Element | null {
	const model = useMessageCardsHostModel(message, rawCards, renderers);
	if (!model) return null;
	return (
		<MessageCardsHostView>
			<MessageCards cards={model.cards} message={model.convMessage} />
		</MessageCardsHostView>
	);
}
