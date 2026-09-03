import type { ConversationAgentMessageViewModel, ConversationUserMessageViewModel } from "./types";

type UserMessageInput = Omit<
	ConversationUserMessageViewModel,
	"kind" | "role" | "deliveryPhase" | "turnId" | "authorId"
> &
	Partial<Pick<ConversationUserMessageViewModel, "deliveryPhase" | "turnId" | "authorId">>;

type AgentMessageInput = Omit<ConversationAgentMessageViewModel, "kind" | "role" | "phase" | "turnId" | "authorId"> &
	Partial<Pick<ConversationAgentMessageViewModel, "phase" | "turnId" | "authorId">>;

export function createConversationUserMessage(input: UserMessageInput): ConversationUserMessageViewModel {
	return {
		...input,
		kind: "user",
		role: "user",
		deliveryPhase: input.deliveryPhase ?? "completed",
		turnId: input.turnId ?? input.id,
		authorId: input.authorId ?? "local-user",
	};
}

export function createConversationAgentMessage(input: AgentMessageInput): ConversationAgentMessageViewModel {
	return {
		...input,
		kind: "agent",
		role: "assistant",
		phase: input.phase ?? "completed",
		turnId: input.turnId ?? input.id,
		authorId: input.authorId ?? "default-agent",
	};
}
