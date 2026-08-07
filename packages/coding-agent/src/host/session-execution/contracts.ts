import type { ImageContent } from "@vetta/ai";
import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";

export interface CodingAgentTurnRetrySettings {
	readonly enabled: boolean;
	readonly maxRetries: number;
	readonly baseDelayMs: number;
	readonly maxDelayMs?: number;
}

export type CodingAgentTurnRetryEvent =
	| {
			readonly type: "auto_retry_start";
			readonly attempt: number;
			readonly maxAttempts: number;
			readonly delayMs: number;
			readonly errorMessage: string;
	  }
	| {
			readonly type: "auto_retry_end";
			readonly success: boolean;
			readonly attempt: number;
			readonly finalError?: string;
	  };

export interface CodingAgentTurnRetryControllerOptions {
	readonly readSettings: () => CodingAgentTurnRetrySettings;
	readonly setEnabled: (enabled: boolean) => void;
	readonly emit: (event: CodingAgentTurnRetryEvent) => void;
}

export interface CodingAgentTurnRetryController {
	readonly retryAttempt: number;
	readonly isRetrying: boolean;
	setAutoRetryEnabled(enabled: boolean): void;
	abortRetry(): void;
	run<T>(
		executeInitial: () => Promise<T>,
		executeRetry: () => Promise<T>,
		readFailure: (result: T) => string | undefined,
	): Promise<T>;
}

export interface CodingAgentTurnSessionHost {
	startActiveSessionOperation<T>(operation: (session: GreenfieldRuntimeSession) => Promise<T>): Promise<T>;
}

export interface CodingAgentTurnCommandHost {
	throwIfExtensionCommand(text: string): void;
	tryExecute(text: string): Promise<boolean>;
}

export interface CodingAgentTurnExecutorOptions {
	readonly sessionHost: CodingAgentTurnSessionHost;
	readonly retryController: CodingAgentTurnRetryController;
	readonly commandHost?: CodingAgentTurnCommandHost;
}

export interface CodingAgentTurnPromptOptions {
	readonly images?: readonly ImageContent[];
	readonly streamingBehavior?: "steer" | "followUp";
	readonly throwOnFailure?: boolean;
}

export interface CodingAgentTurnExecutor {
	prompt(message: string, options?: CodingAgentTurnPromptOptions): Promise<void>;
}
