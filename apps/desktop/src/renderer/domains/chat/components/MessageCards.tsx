import type { CardDescriptor, ConversationMessage, PluginCardProps } from "@vetta-org/plugin-sdk";
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MessageCardsView } from "@vetta/theme-ui/chat";
import { PluginI18nBoundary } from "../../plugins/runtime/plugin-i18n";

/** A card descriptor resolved to its renderer + display metadata. */
export interface ResolvedCard {
	/** Stable React key. */
	id: string;
	/** Owning plugin id (drives the i18n boundary for the rendered component). */
	pluginId: string;
	descriptor: CardDescriptor;
	/** True while synthesized from an in-flight tool (renderer shows a skeleton). */
	pending: boolean;
	Component: ComponentType<PluginCardProps>;
	/** Tab label. */
	title: string;
	/** Tab icon (React node), optional. */
	icon?: ReactNode;
}

class CardErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}
	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("Plugin card failed", error, info.componentStack);
	}
	render(): ReactNode {
		return this.state.failed ? null : this.props.children;
	}
}

function CardBody({ card, message }: { card: ResolvedCard; message: ConversationMessage }): JSX.Element {
	const { Component: Renderer } = card;
	return (
		<CardErrorBoundary>
			<PluginI18nBoundary pluginId={card.pluginId}>
				<Renderer descriptor={card.descriptor} pending={card.pending} message={message} />
			</PluginI18nBoundary>
		</CardErrorBoundary>
	);
}

/**
 * Renders a message's plugin cards. Chrome (tabs/layout toggle) lives in theme-ui.
 */
export function MessageCards({
	cards,
	message,
}: {
	cards: ResolvedCard[];
	message: ConversationMessage;
}): JSX.Element | null {
	const { t } = useTranslation("chat");
	return (
		<MessageCardsView
			messageId={message.id}
			labels={{
				layoutStacked: t("messageCards.layoutStacked"),
				layoutList: t("messageCards.layoutList"),
			}}
			cards={cards.map((card) => ({
				id: card.id,
				title: card.title,
				icon: card.icon,
				pending: card.pending,
				body: <CardBody card={card} message={message} />,
			}))}
		/>
	);
}
