import type { AIErrorDetails } from "./errors.js";
import type { StopReason } from "./finish-reason.js";
import type { Api, Provider } from "./identity.js";
import type { AssistantMessage } from "./message.js";

export interface AssistantMessageIdentity {
	readonly api: Api;
	readonly provider: Provider;
	readonly model: string;
}

export interface AssistantMessageFactoryOptions {
	readonly stopReason?: StopReason;
	readonly errorMessage?: string;
	readonly failure?: AIErrorDetails;
	readonly timestamp?: number;
}

/** Creates the shared zero-value assistant envelope used before provider output arrives. */
export function createAssistantMessage(
	identity: AssistantMessageIdentity,
	options: AssistantMessageFactoryOptions = {},
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: identity.api,
		provider: identity.provider,
		model: identity.model,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: options.stopReason ?? "stop",
		...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
		...(options.failure === undefined ? {} : { failure: options.failure }),
		timestamp: options.timestamp ?? Date.now(),
	};
}
