import type { Api, Model } from "@vetta/ai";
import type { CompactionResult } from "../compaction/index.js";
import type { ProviderConfig } from "./provider-contracts.js";
import type { ExtensionSessionSetup, ExtensionSessionView } from "./session-contracts.js";
import type {
	EcosystemPermissionHookRequest,
	EcosystemPermissionHookResult,
	ExtensionUIContext,
} from "./ui-contracts.js";

export interface ContextUsage {
	/** Estimated context tokens, or null if unknown (e.g. right after compaction, before next LLM response). */
	tokens: number | null;
	contextWindow: number;
	/** Context usage as percentage of context window, or null if tokens is unknown. */
	percent: number | null;
}

export interface CompactOptions {
	customInstructions?: string;
	onComplete?: (result: CompactionResult) => void;
	onError?: (error: Error) => void;
}

/** Model catalogue surface available to extensions. */
export interface ExtensionModelCatalog {
	refresh(): void;
	getError(): string | undefined;
	getAll(): Model<Api>[];
	getAvailable(): Model<Api>[];
	find(provider: string, modelId: string): Model<Api> | undefined;
	isRemote(model: Model<Api>): boolean;
	getRemoteProviders(): Set<string>;
	getApiKey(model: Model<Api>): Promise<string | undefined>;
	getApiKeyForProvider(provider: string): Promise<string | undefined>;
	isUsingOAuth(model: Model<Api>): boolean;
	registerProvider(providerName: string, config: ProviderConfig): void;
}

/**
 * Context passed to extension event handlers.
 */
export interface ExtensionContext {
	/** UI methods for user interaction */
	ui: ExtensionUIContext;
	/** Whether UI is available (false in print/RPC mode) */
	hasUI: boolean;
	/** Current working directory */
	cwd: string;
	/** Session manager (read-only) */
	sessionManager: ExtensionSessionView;
	/** Model registry for API key resolution */
	modelRegistry: ExtensionModelCatalog;
	/** Current model (may be undefined) */
	model: Model<Api> | undefined;
	/** Whether the agent is idle (not streaming) */
	isIdle(): boolean;
	/** Abort the current agent operation */
	abort(): void;
	/** Whether there are queued messages waiting */
	hasPendingMessages(): boolean;
	/** Gracefully shutdown pi and exit. Available in all contexts. */
	shutdown(): void;
	/** Get current context usage for the active model. */
	getContextUsage(): ContextUsage | undefined;
	/** Trigger compaction without awaiting completion. */
	compact(options?: CompactOptions): void;
	/** Get the current effective system prompt. */
	getSystemPrompt(): string;
	/**
	 * Optional ecosystem PermissionRequest gate. Host wires {@link EcosystemHookRuntime}
	 * here; sandbox (and future permission UIs) call before prompting the user.
	 */
	requestEcosystemPermission?(
		request: EcosystemPermissionHookRequest,
	): Promise<EcosystemPermissionHookResult | undefined>;
}

/**
 * Extended context for command handlers.
 * Includes session control methods only safe in user-initiated commands.
 */
export interface ExtensionCommandContext extends ExtensionContext {
	/** Wait for the agent to finish streaming */
	waitForIdle(): Promise<void>;

	/** Start a new session, optionally with initialization. */
	newSession(options?: { parentSession?: string; setup?: ExtensionSessionSetup }): Promise<{ cancelled: boolean }>;

	/** Fork from a specific entry, creating a new session file. */
	fork(entryId: string): Promise<{ cancelled: boolean }>;

	/** Navigate to a different point in the session tree. */
	navigateTree(
		targetId: string,
		options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
	): Promise<{ cancelled: boolean }>;

	/** Switch to a different session file. */
	switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;

	/** Reload extensions, skills, prompts, and themes. */
	reload(): Promise<void>;
}
