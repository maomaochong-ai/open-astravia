import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import { useRendererMarkdownModel } from "@shared/hooks/useRendererMarkdownModel";
import type { ReactNode } from "react";
import { MessageExpansionScope } from "../components/message-list/expansionStore";
import { ConversationExtensionRegistry } from "./extensions";
import { type ConversationFeed, ConversationFeedContext } from "./feed";

/**
 * The boundary of one composed conversation view: the feed it renders, the
 * extensions registered under it, and the view state scoped to `feed.key`.
 */
export function ConversationRoot({
	feed,
	children,
}: {
	readonly feed: ConversationFeed;
	readonly children: ReactNode;
}) {
	const markdown = useRendererMarkdownModel(feed.workspace.cwd, true, feed.workspace.id);
	return (
		<ConversationFeedContext.Provider value={feed}>
			<ConversationExtensionRegistry>
				<RendererMarkdownScope value={markdown}>
					<MessageExpansionScope scope={feed.key}>{children}</MessageExpansionScope>
				</RendererMarkdownScope>
			</ConversationExtensionRegistry>
		</ConversationFeedContext.Provider>
	);
}
