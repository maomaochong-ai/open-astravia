import type { ChatMessage } from "@shared/store/atoms";
import type { MessageListScrollModel } from "../../hooks/useMessageListScrollModel";
import type { AssistantFoldData, BlockSegment } from "./messageBlockModel";
import type { WorkSegment } from "./progressGroupModel";

export type { ChatMessage };

export interface MessageListProps {
	messages: ChatMessage[];
	isStreaming: boolean;
	sessionId?: string | null;
	onSend?: (overrideText?: string) => Promise<void>;
	onAbort?: () => void;
}

export interface MessageListModel {
	isCompacting: boolean;
	isStreaming: boolean;
	messages: ChatMessage[];
	modelSwitchLabels: Map<string, string>;
	scroll: MessageListScrollModel;
	showWaiting: boolean;
	tailMessageId: string | null;
}

export interface AssistantMessageModel {
	conclusionText: string;
	exportProcessSegments: BlockSegment[];
	foldData: AssistantFoldData | null;
	isCurrentlyStreaming: boolean;
	isPredicting: boolean;
	/** Work 模式（agent 声明的阶段组）；coding 模式下不折叠整段过程。 */
	/** 会话模式的叙事能力位（注册表 narration === "staged"）：true = 按 progress 阶段折叠渲染。 */
	stagedNarration: boolean;
	segments: WorkSegment[];
	/** Work 模式折叠条的计数单位是阶段数，而非原始 block 数。 */
	workFoldCount: number;
	showDuration: boolean;
	streamingTailIndex: number;
}
