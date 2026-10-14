import type { ChatConversationItem } from "@shared/store/chat-atoms";
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode, useRef } from "react";

type MessageKind = ChatConversationItem["kind"];

interface MessageTemplateProps {
	readonly children?: ReactNode;
}

function templateFor(kind: MessageKind) {
	function MessageTemplate(_props: MessageTemplateProps): null {
		// Never rendered directly: <Conversation.Messages> renders the children once per row.
		return null;
	}
	MessageTemplate.messageKind = kind;
	return MessageTemplate;
}

/** The structure of each user message row. Parts inside read the row through `useMessage()`. */
export const UserMessageTemplate = templateFor("user");
/** The structure of each agent message row. */
export const AgentMessageTemplate = templateFor("agent");
/** The structure of timeline events (compaction, delegation, Team summaries). */
export const EventMessageTemplate = templateFor("event");

export type MessageTemplates = Partial<Record<MessageKind, ReactNode>>;

function isTemplate(element: ReactElement): element is ReactElement<MessageTemplateProps> {
	return typeof element.type === "function" && "messageKind" in element.type;
}

function collectTemplates(children: ReactNode, templates: Record<string, ReactNode>): void {
	Children.forEach(children, (child) => {
		if (!isValidElement(child)) return;
		if (child.type === Fragment) {
			collectTemplates((child.props as { children?: ReactNode }).children, templates);
			return;
		}
		if (isTemplate(child)) {
			const kind = (child.type as unknown as { messageKind: MessageKind }).messageKind;
			templates[kind] = child.props.children;
		}
	});
}

const identities = new WeakMap<object, number>();
let nextIdentity = 0;

function identityOf(value: object): number {
	let identity = identities.get(value);
	if (identity === undefined) {
		nextIdentity += 1;
		identity = nextIdentity;
		identities.set(value, identity);
	}
	return identity;
}

/** Structural signature of a template tree: element types, keys and props, children included. */
function signatureOf(node: unknown): string {
	if (node === null || node === undefined || typeof node === "boolean") return "";
	if (typeof node === "string" || typeof node === "number") return JSON.stringify(node);
	if (Array.isArray(node)) return `[${node.map(signatureOf).join(",")}]`;
	if (isValidElement(node)) {
		const type = typeof node.type === "string" ? node.type : `#${identityOf(node.type as object)}`;
		const props = node.props as Record<string, unknown>;
		const entries = Object.keys(props)
			.sort()
			.map((name) => `${name}=${signatureOf(props[name])}`);
		return `<${type} ${String(node.key)} ${entries.join(" ")}>`;
	}
	if (typeof node === "object" || typeof node === "function") return `@${identityOf(node as object)}`;
	return String(node);
}

/**
 * Message templates declared in `children`, kept identical across renders while
 * their structure is unchanged. Rows are memoized; a fresh but equivalent
 * template on every parent render would re-render every visible row.
 */
export function useMessageTemplates(children: ReactNode): MessageTemplates {
	const templates: Record<string, ReactNode> = {};
	collectTemplates(children, templates);
	const signature = signatureOf(Object.keys(templates).map((kind) => [kind, templates[kind]]));
	const cache = useRef<{ signature: string; templates: MessageTemplates } | null>(null);
	if (cache.current?.signature !== signature) cache.current = { signature, templates };
	return cache.current.templates;
}
