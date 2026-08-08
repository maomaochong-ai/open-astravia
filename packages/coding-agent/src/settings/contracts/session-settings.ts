export interface ResolvedCompactionSettings {
	readonly enabled: boolean;
	readonly reserveTokens: number;
	readonly minFreePercent: number;
	readonly keepRecentTokens: number;
}

export interface ResolvedRetrySettings {
	readonly enabled: boolean;
	readonly maxRetries: number;
	readonly baseDelayMs: number;
	readonly maxDelayMs: number;
}

export interface SessionSettingsPort {
	getSteeringMode(): "all" | "one-at-a-time";
	setSteeringMode(mode: "all" | "one-at-a-time"): void;
	getFollowUpMode(): "all" | "one-at-a-time";
	setFollowUpMode(mode: "all" | "one-at-a-time"): void;
	getCompactionEnabled(): boolean;
	setCompactionEnabled(enabled: boolean): void;
	getCompactionReserveTokens(): number;
	getCompactionMinFreePercent(): number;
	getCompactionKeepRecentTokens(): number;
	getCompactionSettings(): ResolvedCompactionSettings;
	getBranchSummarySettings(): { reserveTokens: number };
	getRetryEnabled(): boolean;
	setRetryEnabled(enabled: boolean): void;
	getRetrySettings(): ResolvedRetrySettings;
	getHideThinkingBlock(): boolean;
	setHideThinkingBlock(hide: boolean): void;
	getImageAutoResize(): boolean;
	setImageAutoResize(enabled: boolean): void;
	getBlockImages(): boolean;
	setBlockImages(blocked: boolean): void;
	getPersonalization(): { personaId: string; customPrompt: string };
}
