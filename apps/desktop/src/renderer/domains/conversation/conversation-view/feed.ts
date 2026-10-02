import type { ConversationParticipantViewModel, ConversationUserMessageViewModel } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import { type Atom, atom } from "jotai";
import { createContext, useContext } from "react";

/**
 * Commands on a user message. Each is a hook so a part can follow state the
 * command owns (e.g. an edit in progress); parts call them unconditionally from
 * a child that only mounts when the capability exists.
 */
export interface UserMessageCommands {
	/** Replace the last user message: fills the composer, replaced on send. */
	readonly useEdit: (
		message: ConversationUserMessageViewModel,
		isLastUserMessage: boolean,
	) => { readonly available: boolean; readonly pending: boolean; readonly onEdit: () => void };
	/** Switch between sibling branches and fork a new conversation from a message. */
	readonly useHistory: (message: ConversationUserMessageViewModel) => {
		readonly canSwitch: boolean;
		readonly branchIndex: number;
		readonly branchTotal: number;
		readonly onPrevious: () => void;
		readonly onNext: () => void;
		readonly forkAvailable: boolean;
		readonly onFork: () => void;
	};
	readonly useDelete: (message: ConversationUserMessageViewModel) => {
		readonly available: boolean;
		readonly onDelete: () => void;
	};
}

/**
 * What the Runtime behind a conversation lets the view do. A part that needs a
 * capability renders nothing when the feed does not provide it, so a read-only
 * feed stays read-only however it is composed (ADR-0147).
 */
export interface ConversationCapabilities {
	readonly userMessageCommands?: UserMessageCommands;
	/** Stop the running Turn, e.g. before replacing the last user message. */
	readonly abort?: () => void;
	/** Open the conversation of a Team member. */
	readonly openTeamMember?: (memberId: string) => void;
	/** Runtime whose subagent observations belong to this conversation. */
	readonly subagentRuntimeId?: string;
}

/**
 * A headless conversation source. It is a stable object: messages and streaming
 * state are atoms read inside the view, so composing a view does not re-render
 * the composition on every streamed delta.
 */
export interface ConversationFeed {
	/** Scope of view state (scroll position, expansion, cards) and the list identity. */
	readonly key: string | null;
	readonly items: Atom<readonly ChatConversationItem[]>;
	readonly streaming: Atom<boolean>;
	/** The Runtime is predicting the next prompt after the newest reply. */
	readonly predicting: Atom<boolean>;
	/** Where links and file references in the messages resolve. */
	readonly workspace: ActivityWorkspace;
	readonly participants: readonly ConversationParticipantViewModel[];
	/** Label shown while the running reply has no output yet. */
	readonly pendingLabel?: string;
	/** An entry to bring into view once, e.g. after opening a fork's parent. */
	readonly scrollTarget?: { readonly key: string; readonly onReached: () => void };
	readonly capabilities: ConversationCapabilities;
}

const NO_PARTICIPANTS: readonly ConversationParticipantViewModel[] = [];
const NEVER = atom(false);

export interface ConversationFeedInput {
	readonly key: string | null;
	readonly items: Atom<readonly ChatConversationItem[]>;
	readonly workspace: ActivityWorkspace;
	readonly streaming?: Atom<boolean>;
	readonly predicting?: Atom<boolean>;
	readonly participants?: readonly ConversationParticipantViewModel[];
	readonly pendingLabel?: string;
	readonly scrollTarget?: ConversationFeed["scrollTarget"];
	readonly capabilities?: ConversationCapabilities;
}

export function createConversationFeed(input: ConversationFeedInput): ConversationFeed {
	return {
		key: input.key,
		items: input.items,
		streaming: input.streaming ?? NEVER,
		predicting: input.predicting ?? NEVER,
		workspace: input.workspace,
		participants: input.participants ?? NO_PARTICIPANTS,
		...(input.pendingLabel ? { pendingLabel: input.pendingLabel } : {}),
		...(input.scrollTarget ? { scrollTarget: input.scrollTarget } : {}),
		capabilities: input.capabilities ?? {},
	};
}

export const ConversationFeedContext = createContext<ConversationFeed | null>(null);

export function useConversationFeed(part = "Conversation part"): ConversationFeed {
	const feed = useContext(ConversationFeedContext);
	if (!feed) throw new Error(`${part} must be rendered inside <Conversation.Root>`);
	return feed;
}

/**
 * The capability a part needs, or undefined when this feed does not offer it.
 * Parts render nothing without it instead of reaching for global session state.
 */
export function useConversationCapability<Name extends keyof ConversationCapabilities>(
	name: Name,
): ConversationCapabilities[Name] {
	return useConversationFeed().capabilities[name];
}
