import type { ContentBlock } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import {
	type ComponentType,
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";

export interface ConversationRowDecoratorProps {
	readonly message: ChatConversationItem;
	readonly children: ReactNode;
}

/**
 * A cross-cutting feature registered by a component placed anywhere under
 * `Conversation.Root` (ADR-0147). Registering never changes the component tree's
 * shape, so adding or removing an extension does not remount the list.
 */
export interface ConversationExtension {
	readonly id: string;
	/** Wraps each message row's content, e.g. a hover marker or a banner after an anchor message. */
	readonly decorateRow?: ComponentType<ConversationRowDecoratorProps>;
	/** State this extension shares with its own parts through `useConversationExtensionValue`. */
	readonly value?: unknown;
	/** Replaces or decorates how a content block type renders; the later registered extension wins. */
	readonly renderBlock?: Partial<Record<ContentBlock["type"], ComponentType<ConversationBlockRendererProps>>>;
}

export interface ConversationBlockRendererProps {
	readonly block: ContentBlock;
	readonly isStreamingTail?: boolean;
	readonly exportMode?: boolean;
	/** The default presentation; a renderer may return it, wrap it or replace it. */
	readonly children: ReactNode;
}

interface ExtensionRegistry {
	readonly extensions: readonly ConversationExtension[];
	readonly register: (extension: ConversationExtension) => void;
	readonly unregister: (id: string) => void;
}

const ExtensionRegistryContext = createContext<ExtensionRegistry | null>(null);

export function ConversationExtensionRegistry({ children }: { readonly children: ReactNode }) {
	const [extensions, setExtensions] = useState<readonly ConversationExtension[]>([]);
	const register = useCallback((extension: ConversationExtension) => {
		setExtensions((previous) => {
			const index = previous.findIndex((candidate) => candidate.id === extension.id);
			if (index < 0) return [...previous, extension];
			if (previous[index] === extension) return previous;
			const next = [...previous];
			next[index] = extension;
			return next;
		});
	}, []);
	const unregister = useCallback((id: string) => {
		setExtensions((previous) => {
			const next = previous.filter((candidate) => candidate.id !== id);
			return next.length === previous.length ? previous : next;
		});
	}, []);
	const registry = useMemo(() => ({ extensions, register, unregister }), [extensions, register, unregister]);
	return <ExtensionRegistryContext.Provider value={registry}>{children}</ExtensionRegistryContext.Provider>;
}

function useRegistry(part: string): ExtensionRegistry {
	const registry = useContext(ExtensionRegistryContext);
	if (!registry) throw new Error(`${part} must be rendered inside <Conversation.Root>`);
	return registry;
}

/**
 * Register an extension for as long as the calling component is mounted. The
 * declaration order of extension components decides how row decorators nest:
 * the first registered decorator is the outermost.
 */
export function useConversationExtension(extension: ConversationExtension): void {
	const { register, unregister } = useRegistry(`Extension "${extension.id}"`);
	useLayoutEffect(() => {
		register(extension);
	}, [register, extension]);
	useLayoutEffect(() => () => unregister(extension.id), [unregister, extension.id]);
}

export function useConversationExtensionValue<T>(id: string): T | undefined {
	const { extensions } = useRegistry(`Extension value "${id}"`);
	return extensions.find((extension) => extension.id === id)?.value as T | undefined;
}

/** Like `useConversationExtensionValue`, for parts that also render outside a conversation (e.g. export). */
export function useOptionalConversationExtensionValue<T>(id: string): T | undefined {
	const registry = useContext(ExtensionRegistryContext);
	return registry?.extensions.find((extension) => extension.id === id)?.value as T | undefined;
}

/** The registered renderer for a block type, if any; also usable outside a conversation (export). */
export function useConversationBlockRenderer(
	type: ContentBlock["type"],
): ComponentType<ConversationBlockRendererProps> | undefined {
	const registry = useContext(ExtensionRegistryContext);
	if (!registry) return undefined;
	for (let index = registry.extensions.length - 1; index >= 0; index--) {
		const renderer = registry.extensions[index].renderBlock?.[type];
		if (renderer) return renderer;
	}
	return undefined;
}

/** Applies every registered row decorator around one message row's content. */
export function ConversationRowDecorations({ message, children }: ConversationRowDecoratorProps) {
	const { extensions } = useRegistry("Conversation row");
	let content = children;
	for (let index = extensions.length - 1; index >= 0; index--) {
		const Decorator = extensions[index].decorateRow;
		if (Decorator) content = <Decorator message={message}>{content}</Decorator>;
	}
	return <>{content}</>;
}
