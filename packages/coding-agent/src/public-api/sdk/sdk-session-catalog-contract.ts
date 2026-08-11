export interface CodingAgentSessionSummary {
	readonly id: string;
	readonly path: string;
	readonly cwd: string;
	readonly name?: string;
	readonly firstMessage: string;
	readonly modifiedAt: number;
	readonly lastMessagePreview?: string;
	readonly parentSessionPath?: string;
	readonly parentEntryId?: string;
}

export interface CreateCodingAgentSessionCatalogOptions {
	readonly conversationDir: string;
	readonly cwd?: string;
}

/** 离线会话查询门面；不负责活动 Session 的创建、锁或生命周期。 */
export interface CodingAgentSessionCatalog {
	list(): Promise<readonly CodingAgentSessionSummary[]>;
	findRecent(): Promise<CodingAgentSessionSummary | undefined>;
}
