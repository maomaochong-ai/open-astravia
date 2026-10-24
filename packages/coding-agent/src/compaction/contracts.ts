import type { AgentMessage } from "@astravia/agent-core";
import type { ImageContent, TextContent } from "@astravia/ai";

export interface CompactionHistoryEntryBase {
	readonly type: string;
	readonly id: string;
	readonly parentId: string | null;
	readonly timestamp: string;
}

export interface CompactionMessageEntry extends CompactionHistoryEntryBase {
	readonly type: "message";
	readonly message: AgentMessage;
}

export interface CompactionEntry<T = unknown> extends CompactionHistoryEntryBase {
	readonly type: "compaction";
	readonly summary: string;
	readonly firstKeptEntryId: string;
	readonly tokensBefore: number;
	readonly details?: T;
	readonly fromHook?: boolean;
}

export interface CompactionBranchSummaryEntry<T = unknown> extends CompactionHistoryEntryBase {
	readonly type: "branch_summary";
	readonly fromId: string;
	readonly summary: string;
	readonly details?: T;
	readonly fromHook?: boolean;
}

export interface CompactionCustomMessageEntry<T = unknown> extends CompactionHistoryEntryBase {
	readonly type: "custom_message";
	readonly customType: string;
	readonly content: string | (TextContent | ImageContent)[];
	readonly details?: T;
	readonly display: boolean;
}

export interface CompactionMetadataEntry extends CompactionHistoryEntryBase {
	readonly type: "thinking_level_change" | "model_change" | "custom" | "label" | "session_info" | "tool_timing";
}

/**
 * 压缩算法唯一理解的历史视图。会话存储条目与 Runtime Conversation
 * 都在调用边界投影到这个结构，算法不持有任何存储实现。
 */
export type CompactionHistoryEntry =
	| CompactionMessageEntry
	| CompactionEntry
	| CompactionBranchSummaryEntry
	| CompactionCustomMessageEntry
	| CompactionMetadataEntry;

/** 分支遍历所需的最小只读端口。 */
export interface BranchHistoryReader<TEntry extends CompactionHistoryEntry = CompactionHistoryEntry> {
	getBranch(leafId?: string): readonly TEntry[];
	getEntry(id: string): TEntry | undefined;
}

export interface CompactionResult<T = unknown> {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: T;
}

/** 摘要正文语言：由宿主按自己的「读的人是谁」决定，见 `CompactionSettings.summaryLanguage`。 */
export type SummaryLanguage = "zh" | "en";

export interface CompactionSettings {
	enabled: boolean;
	reserveTokens: number;
	minFreePercent: number;
	keepRecentTokens: number;
	/**
	 * 摘要正文与标题用哪种语言写；缺省遵循历史行为——跟随会话语言。
	 *
	 * 摘要卡是摆在界面上给人读的：中文界面里显示一份英文摘要就是混语言。宿主知道
	 * 界面用的是哪种语言，所以由它决定这里填什么。
	 */
	summaryLanguage?: SummaryLanguage;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 36000,
	minFreePercent: 20,
	keepRecentTokens: 20000,
};
