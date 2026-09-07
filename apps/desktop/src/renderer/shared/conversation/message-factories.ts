import type { ConversationAgentMessageViewModel, ConversationUserMessageViewModel } from "./types";

/**
 * 普通会话里唯一的 Agent 参与者标识。Team 会话按成员 id 区分作者，普通会话只有一个
 * 作者，因此这里是常量；会话绑定了某个 Agent 时，participant 就按这个 id 对号入座。
 */
export const DEFAULT_AGENT_PARTICIPANT_ID = "default-agent";

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
		authorId: input.authorId ?? DEFAULT_AGENT_PARTICIPANT_ID,
	};
}
