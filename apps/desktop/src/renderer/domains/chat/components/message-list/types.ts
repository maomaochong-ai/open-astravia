import type { ChatConversationItem } from "@shared/store/atoms";
import type { MessageListScrollModel } from "../../hooks/useMessageListScrollModel";
import type { AssistantFoldData, BlockSegment } from "./messageBlockModel";
import type { WorkSegment } from "./progressGroupModel";

export type { ChatConversationItem };

export interface MessageListProps {
	messages: ChatConversationItem[];
	isStreaming: boolean;
	sessionId?: string | null;
	pendingLabel?: string;
	onSend?: (overrideText?: string) => Promise<void>;
	onAbort?: () => void;
}

export interface MessageListModel {
	parentEntryId?: string;
	parentSessionPath?: string;
	isCompacting: boolean;
	isStreaming: boolean;
	messages: ChatConversationItem[];
	modelSwitchLabels: Map<string, string>;
	scroll: MessageListScrollModel;
	waitingForResponse: boolean;
	tailMessageId: string | null;
}

export interface AssistantMessageModel {
	conclusionText: string;
	exportProcessSegments: BlockSegment[];
	foldData: AssistantFoldData | null;
	isCurrentlyStreaming: boolean;
	isPredicting: boolean;
	/** 仍在追加的 thinking block id：原位改用实时滚动卡片渲染。 */
	liveThinkingId: string | null;
	/** Work 模式（agent 声明的阶段组）；coding 模式下不折叠整段过程。 */
	/** 会话模式的叙事能力位（注册表 narration === "staged"）：true = 按 progress 阶段折叠渲染。 */
	stagedNarration: boolean;
	segments: WorkSegment[];
	/** Work 模式折叠条的计数单位是阶段数，而非原始 block 数。 */
	workFoldCount: number;
	durationAvailable: boolean;
	streamingTailIndex: number;
}
