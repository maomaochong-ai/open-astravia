import type { ConversationParticipantViewModel } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/atoms";
import type { MessageListScrollModel } from "../../hooks/useMessageListScrollModel";
import type { ModelSwitchLabel } from "./message-list-derived";
import type { AssistantFoldData, BlockSegment } from "./messageBlockModel";
import type { WorkSegment } from "./progressGroupModel";

export type { ChatConversationItem };

/** What the viewport derives its list model from. */
export interface MessageListModelInput {
	messages: readonly ChatConversationItem[];
	isStreaming: boolean;
	participants?: readonly ConversationParticipantViewModel[];
	onTeamMemberOpen?: (memberId: string) => void;
}

export interface MessageListModel {
	isStreaming: boolean;
	messages: readonly ChatConversationItem[];
	modelSwitchLabels: Map<string, ModelSwitchLabel>;
	scroll: MessageListScrollModel;
	tailMessageId: string | null;
	participantsById: ReadonlyMap<string, ConversationParticipantViewModel>;
	participants: readonly ConversationParticipantViewModel[];
	onTeamMemberOpen?: MessageListModelInput["onTeamMemberOpen"];
}

export interface AssistantMessageModel {
	conclusionText: string;
	exportProcessSegments: BlockSegment[];
	foldData: AssistantFoldData | null;
	isCurrentlyStreaming: boolean;
	isPredicting: boolean;
	/** 仍在追加的 thinking block id：原位改用实时滚动卡片渲染。 */
	liveThinkingId: string | null;
	segments: WorkSegment[];
	/** 折叠条的计数单位是阶段数，而非原始 block 数。 */
	workFoldCount: number;
	durationAvailable: boolean;
	streamingTailIndex: number;
}
