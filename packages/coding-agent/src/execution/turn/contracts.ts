import type { ImageContent } from "@vetta/ai";
import type {
	RuntimeFailure,
	RuntimeObservationContext,
	RuntimeObservationPublisher,
	RuntimeSession,
	RuntimeTurnRetryController,
	RuntimeTurnRetryEvent,
	RuntimeTurnRetrySettings,
} from "@vetta/runtime-core";

export type CodingAgentTurnRetrySettings = RuntimeTurnRetrySettings;

export type CodingAgentTurnRetryEvent = RuntimeTurnRetryEvent;

export interface CodingAgentTurnRetryControllerOptions {
	readonly readSettings: () => CodingAgentTurnRetrySettings;
	readonly setEnabled: (enabled: boolean) => void;
	readonly emit: (event: CodingAgentTurnRetryEvent) => void;
	readonly observationPublisher?: RuntimeObservationPublisher;
	readonly observationContext?: RuntimeObservationContext;
}

export type CodingAgentTurnFailure = RuntimeFailure;

export type CodingAgentTurnRetryController = RuntimeTurnRetryController;

export interface CodingAgentTurnSessionHost {
	startActiveSessionOperation<T>(operation: (session: RuntimeSession) => Promise<T>): Promise<T>;
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
