import type { TruncationResult } from "@vetta/runtime-tools/coding";

export interface ExtensionEventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface ExtensionExecOptions {
	signal?: AbortSignal;
	timeout?: number;
	cwd?: string;
}

export interface ExtensionExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
}

export interface ExtensionFooterDataProvider {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getAvailableProviderCount(): number;
	onBranchChange(callback: () => void): () => void;
}

export type KeyId = string;

export type AppAction =
	| "interrupt"
	| "clear"
	| "exit"
	| "suspend"
	| "cycleThinkingLevel"
	| "cycleModelForward"
	| "cycleModelBackward"
	| "selectModel"
	| "expandTools"
	| "toggleThinking"
	| "toggleSessionNamedFilter"
	| "externalEditor"
	| "followUp"
	| "dequeue"
	| "pasteImage"
	| "newSession"
	| "tree"
	| "fork"
	| "resume";

export interface ExtensionKeybindings {
	getKeys(action: AppAction): KeyId[];
	getEffectiveConfig(): Record<string, KeyId | KeyId[]>;
}

export type ExtensionKeybindingsConfig = Readonly<Record<string, KeyId | readonly KeyId[]>>;

export interface ExtensionResourceDiagnostic {
	type: "warning" | "error" | "collision";
	message: string;
	path?: string;
}

export type SlashCommandSource = "extension" | "prompt" | "skill";
export type SlashCommandLocation = "user" | "project" | "path";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	location?: SlashCommandLocation;
	path?: string;
}

export interface UserBashOperations {
	exec(
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
		},
	): Promise<{ exitCode: number | null }>;
}

export interface UserBashResult {
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	fullOutputPath?: string;
}

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	pathCorrections?: Array<{ original: string; corrected: string }>;
	backgroundTaskId?: string;
	autoPromoted?: boolean;
}

export type EventBus = ExtensionEventBus;
export type ExecOptions = ExtensionExecOptions;
export type ExecResult = ExtensionExecResult;
export type ReadonlyFooterDataProvider = ExtensionFooterDataProvider;
export type KeybindingsManager = ExtensionKeybindings;
export type BashOperations = UserBashOperations;
export type BashResult = UserBashResult;
