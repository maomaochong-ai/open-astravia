import type { Transport } from "@vetta/ai";

export interface CompactionSettings {
	enabled?: boolean;
	reserveTokens?: number;
	minFreePercent?: number;
	keepRecentTokens?: number;
}

export interface BranchSummarySettings {
	reserveTokens?: number;
}

export interface RetrySettings {
	enabled?: boolean;
	maxRetries?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
}

export interface TerminalSettings {
	showImages?: boolean;
	clearOnShrink?: boolean;
}

export interface ImageSettings {
	autoResize?: boolean;
	blockImages?: boolean;
}

export interface PersonalizationSettings {
	personaId?: string;
	customPrompt?: string;
}

export interface ThinkingBudgetsSettings {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

export interface MarkdownSettings {
	codeBlockIndent?: string;
}

export type TransportSetting = Transport;

export type PackageSource =
	| string
	| {
			source: string;
			extensions?: string[];
			skills?: string[];
			prompts?: string[];
			themes?: string[];
	  };

export interface SettingsDocument {
	lastChangelogVersion?: string;
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: string;
	transport?: TransportSetting;
	steeringMode?: "all" | "one-at-a-time";
	followUpMode?: "all" | "one-at-a-time";
	theme?: string;
	compaction?: CompactionSettings;
	branchSummary?: BranchSummarySettings;
	retry?: RetrySettings;
	hideThinkingBlock?: boolean;
	shellPath?: string;
	quietStartup?: boolean;
	shellCommandPrefix?: string;
	collapseChangelog?: boolean;
	packages?: PackageSource[];
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	themes?: string[];
	enableSkillCommands?: boolean;
	terminal?: TerminalSettings;
	images?: ImageSettings;
	personalization?: PersonalizationSettings;
	enabledModels?: string[];
	doubleEscapeAction?: "fork" | "tree" | "none";
	thinkingBudgets?: ThinkingBudgetsSettings;
	editorPaddingX?: number;
	autocompleteMaxVisible?: number;
	showHardwareCursor?: boolean;
	markdown?: MarkdownSettings;
	enableMcp?: boolean;
	mcpDebug?: boolean;
	serverUrl?: string;
	serverToken?: string;
}

export type SettingsScope = "global" | "project";
