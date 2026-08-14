import type { AssistantMessage, StopReason, Usage } from "../protocol/index.js";

export interface ModelWarning {
	readonly code?: string;
	readonly message: string;
	readonly provider?: string;
}

export interface ModelResponseMetadata {
	readonly requestId?: string;
	readonly responseId?: string;
	readonly timestamp?: number;
	readonly headers?: Readonly<Record<string, string>>;
}

export interface ModelCallMetadata {
	readonly finishReason?: {
		readonly unified: StopReason;
		readonly raw?: string;
	};
	readonly usage?: Usage;
	readonly warnings?: readonly ModelWarning[];
	readonly response?: ModelResponseMetadata;
	readonly providerMetadata?: Readonly<Record<string, unknown>>;
}

export interface ModelCallResult extends ModelCallMetadata {
	readonly message: AssistantMessage;
	readonly finishReason: {
		readonly unified: StopReason;
		readonly raw?: string;
	};
	readonly usage: Usage;
	readonly warnings: readonly ModelWarning[];
}

export function createModelCallResult(message: AssistantMessage, metadata: ModelCallMetadata = {}): ModelCallResult {
	return {
		message,
		finishReason: metadata.finishReason ?? { unified: message.stopReason },
		usage: metadata.usage ?? message.usage,
		warnings: metadata.warnings ?? [],
		response: metadata.response,
		providerMetadata: metadata.providerMetadata,
	};
}

export function createModelCallMetadataFromMessage(message: AssistantMessage): ModelCallMetadata {
	return createModelCallMetadata({ unified: message.stopReason }, message.usage);
}

export function createModelCallMetadata(
	finishReason: ModelCallMetadata["finishReason"],
	usage: Usage,
	additional: Omit<ModelCallMetadata, "finishReason" | "usage"> = {},
): ModelCallMetadata {
	return { finishReason, usage, ...additional };
}

export async function collectModelCallResult(response: {
	readonly result: Promise<AssistantMessage>;
	readonly metadata?: Promise<ModelCallMetadata>;
}): Promise<ModelCallResult> {
	const [message, metadata] = await Promise.all([response.result, response.metadata ?? Promise.resolve({})]);
	return createModelCallResult(message, metadata);
}
