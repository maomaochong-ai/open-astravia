import {
	type ConversationBlockRendererProps,
	useConversationBlockRenderer,
} from "../../conversation-view/extensions";

/**
 * Renders a content block through the renderer an extension registered for its
 * type (`ConversationExtension.renderBlock`), or its default presentation.
 */
export function ContentRenderer(props: ConversationBlockRendererProps) {
	const Renderer = useConversationBlockRenderer(props.block.type);
	return Renderer ? <Renderer {...props} /> : <>{props.children}</>;
}
